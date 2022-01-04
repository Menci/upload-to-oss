import fs from "fs";
import path from "path";
import { createHash } from "crypto";

import klaw from "klaw";
import OSS from "ali-oss";
import * as core from "@actions/core";

const input = {
  accessKeyId: core.getInput("access-key-id"),
  accessKeySecret: core.getInput("access-key-secret"),
  securityToken: core.getInput("security-token"),
  bucket: core.getInput("bucket"),
  endpoint: core.getInput("endpoint"),
  localPath: core.getInput("local-path"),
  remotePath: core.getInput("remote-path"),
  include: core.getInput("include-regex"),
  exclude: core.getInput("exclude-regex"),
  headers: core.getInput("headers"),
  delayHtmlFileUpload: core.getBooleanInput("delay-html-file-upload")
};

const oss = new OSS({
  accessKeyId: input.accessKeyId,
  accessKeySecret: input.accessKeySecret,
  stsToken: input.securityToken,
  bucket: input.bucket,
  endpoint: input.endpoint,
});

function normalizePath(pathString: string, leadingSlash: boolean, trailingSlash: boolean, whenRoot: string) {
  pathString = path.posix.normalize(pathString);
  
  if (leadingSlash && !pathString.startsWith("/"))
    pathString = "/" + pathString;
  if (!leadingSlash && pathString.startsWith("/"))
    pathString = pathString.slice(1);

  if (trailingSlash && !pathString.endsWith("/"))
    pathString = pathString + "/";
  if (!trailingSlash && pathString.endsWith("/"))
    pathString = pathString.slice(0, -1);

  if (pathString === "/" || pathString === "") return whenRoot;

  return pathString;
}

async function listRemote() {
  const prefix = normalizePath(input.remotePath, false, true, "");
  let continuationToken: string = null;

  const results = new Map<string, string>();

  do {
    const query: OSS.ListV2ObjectsQuery = {
      prefix,
      "max-keys": "1000"
    };

    if (continuationToken)
      query["continuation-token"] = continuationToken;

    const response = await (oss as unknown as OSS.ClusterClient).listV2(query, {});
    for (const object of response.objects || []) {
      results.set(object.name.slice(prefix.length), object.etag.split('"').join("").toLowerCase());
    }
    continuationToken = response["nextContinuationToken"];
  } while (continuationToken)

  return results;
}

async function listLocal() {
  core.startGroup("List local files");
  
  const localPath = path.resolve(input.localPath);
  const results = new Map<string, string>();

  const includeRegex = new RegExp(input.include);
  const excludeRegex = new RegExp(input.exclude);

  await new Promise((resolve, reject) => {
    klaw(localPath)
      .on("data", async item => {
        if (!item.stats.isFile()) return;
    
        try {
          const relativePath = path.relative(localPath, item.path);

          if (!includeRegex.test(relativePath) || excludeRegex.test(relativePath)) {
            console.log(`Skipping local file ${JSON.stringify(relativePath)}`);
            return;
          }

          const md5 = createHash("md5").update(await fs.promises.readFile(item.path)).digest("hex");
      
          results.set(relativePath, md5);
        } catch (e) {
          reject(e);
        }
      })
      .on("end", resolve)
      .on("error", reject);
  });

  core.endGroup();

  return results;
}

async function main() {
  const local = await listLocal();
  const remote = await listRemote();

  const uploadList = Array.from(local.keys()).filter(key => remote.get(key) !== local.get(key));
  const deleteList = Array.from(remote.keys()).filter(key => !local.has(key));

  const remotePath = normalizePath(input.remotePath, false, true, "");
  const localPath = input.localPath;
  const headers = JSON.parse(input.headers.trim() || '{}');

  core.startGroup("Upload files");
  for (
    const currentUploadList of
      input.delayHtmlFileUpload
      ? [
        uploadList.filter(filePath => !filePath.toLowerCase().endsWith(".html")),
        uploadList.filter(filePath => filePath.toLowerCase().endsWith(".html")),
      ]
      : [uploadList]
  ) {
    await Promise.all(currentUploadList.map(async key => {
      const fileLocalPath = path.resolve(localPath, key);
      const fileRemotePath = remotePath + key;
      await oss.put(fileRemotePath, fileLocalPath, { headers });
      console.log(`Uploaded file ${JSON.stringify(key)}`);
    }));  
  }
  core.endGroup()
  
  core.startGroup("Delete files");
  await Promise.all(deleteList.map(async key => {
    const fileRemotePath = remotePath + key;
    await oss.delete(fileRemotePath);
    console.log(`Deleted file ${JSON.stringify(key)}`);
  }));
  core.endGroup()
}

main().then(() => {
  process.exit();
}).catch(err => {
  core.setFailed(err);
  process.exit(1);
});
