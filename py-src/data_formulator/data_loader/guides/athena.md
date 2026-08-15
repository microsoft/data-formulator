**Example**

AWS profile `default`, region `us-east-1`, workgroup `primary`

**Credentials**

- **AWS profile:** Recommended locally. Enter a profile from `~/.aws/credentials`. Create one with `aws configure --profile <name>`.
- **Access keys:** Enter the access key ID and secret access key. Temporary credentials also require the session token.

**Access**

The IAM identity needs permission to run and inspect Athena queries, read the Glue catalog, and read/write the S3 locations used by the data and query results.

**Scope**

Leave `database` empty to browse available databases. The selected workgroup supplies the result location unless `output_location` is set in Advanced settings.
