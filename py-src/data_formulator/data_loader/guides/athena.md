**Example**

region_name: `us-east-1` · workgroup: `primary` · aws_profile: `default`

**Sign in**

- **AWS profile:** recommended. Enter a profile from `~/.aws/credentials`; create one with `aws configure --profile <name>`.
- **Access keys:** enter an access key ID and secret. Temporary credentials also need the session token.

**Access**

The identity needs to run Athena queries, read the Glue catalog, and read and write the S3 locations for your data and query results.

**Scope**

Leave `database` empty to browse every database. Results go to the workgroup's location unless you set `output_location` in Advanced settings.
