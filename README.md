# GitHub Action for upload files to Aliyun OSS

Upload files in a directory to Aliyun OSS with a prefix incrementally, with filename filter.

Incremental upload is implemented by comparing local MD5 and remote `eTag` (`eTag` = MD5 when uploaded with `PutObject`).

# Usage

```yaml
jobs:
  build-and-deploy:
    name: Build and Deploy website to OSS
    runs-on: ubuntu-latest
    steps:
      - name: Check out
        uses: actions/checkout@v2
      # ... build your static website
      - uses: Menci/upload-to-oss@beta-v1
        with:
          # Use Access Key
          access-key-id: ${{ secrets.ALIYUN_ACCESS_KEY_ID }}
          access-key-secret: ${{ secrets.ALIYUN_ACCESS_KEY_SECRET }}
          # Or use STS Token
          # security-token: ${{ secrets.ALIYUN_SECURITY_TOKEN }}

          bucket: ${{ secrets.ALIYUN_OSS_BUCKET }}
          endpoint: ${{ secrets.ALIYUN_OSS_ENDPOINT }}

          # Upload the built website files in "dist" directory to remote "my-website/" prefix
          local-path: dist
          remote-path: my-website

          # Include HTML files only
          include-regex: \.html$
          # Exclude some files
          excluce-regex: dont-upload-this\.html$

          # Set some headers (in JSON format)
          headers: |
            {
              "Cache-Control": "public, max-age=60"
            }

          # Upload ALL other files before uploading HTML files
          delay-html-file-upload: true
```
