**Example**

property_id: `123456789`, shown in Google Analytics under **Admin → Property details**.

**Sign in**

- **Service account file:** in a Google Cloud project, enable the **Google Analytics Data API** (and the **Google Analytics Admin API** to list properties), create a service account and a JSON key, then enter the key file's path. In Google Analytics, open **Admin → Property access management** and add the service account's email with the **Viewer** role.
- **Application default credentials:** gcloud's own client cannot request Analytics access, so in a project where those APIs are enabled, create an OAuth client ID of type **Desktop app**, download its JSON, and run `gcloud auth application-default login --client-id-file=<client.json> --scopes=https://www.googleapis.com/auth/analytics.readonly`. Setting `GOOGLE_APPLICATION_CREDENTIALS` to a service account key also works.

**Scope**

Leave `property_id` empty to list every property the identity can read, or enter one property ID to open only that one.

**Data**

Without a Date filter, the last 28 days up to yesterday are queried, in the property's time zone. Columns are the property's dimensions and metrics, including custom definitions. Some dimension and metric combinations are not compatible; Google rejects them with an error message.
