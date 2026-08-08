**Authentication**

**Example**

Project `my-gcp-project`, dataset `analytics`, location `US`

**Sign in**

- **Application Default Credentials:** Recommended locally. Install the [Google Cloud CLI](https://cloud.google.com/sdk/docs/install), run `gcloud auth application-default login`, and leave `credentials_path` empty.
- **Service account:** Enter the full path to its JSON key file, or set `GOOGLE_APPLICATION_CREDENTIALS` and leave the field empty.

**Access**

The identity needs **BigQuery Data Viewer** for the datasets and **BigQuery Job User** for the project.

**Scope**

Leave `dataset_id` empty to browse datasets, or enter one or more comma-separated dataset IDs. Set `location` to the datasets' BigQuery location; `US` is only the default.
