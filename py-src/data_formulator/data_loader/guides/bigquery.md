**Example**

project_id: `my-gcp-project` · dataset_id: `analytics` · location: `US`

**Sign in**

- **Application default credentials:** recommended. Install the [Google Cloud CLI](https://cloud.google.com/sdk/docs/install) and run `gcloud auth application-default login`, or set `GOOGLE_APPLICATION_CREDENTIALS`.
- **Service account file:** enter the path to the account's JSON key file.

**Access**

The identity needs **BigQuery Data Viewer** on the datasets and **BigQuery Job User** on the project.

**Scope**

Leave `dataset_id` empty to browse every dataset, or enter IDs separated by commas. Set `location` to where the datasets live.
