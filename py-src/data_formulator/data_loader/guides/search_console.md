**Example**

site_url: `sc-domain:example.com` for a Domain property, or `https://www.example.com/` for a URL-prefix property.

**Sign in**

- **Service account file:** in a Google Cloud project, enable the **Google Search Console API**, create a service account and a JSON key, then enter the key file's path. In Search Console, open **Settings → Users and permissions** and add the service account's email as a user of each property.
- **Application default credentials:** gcloud's own client cannot request Search Console access, so in a project where the Search Console API is enabled, create an OAuth client ID of type **Desktop app**, download its JSON, and run `gcloud auth application-default login --client-id-file=<client.json> --scopes=https://www.googleapis.com/auth/webmasters.readonly`. Setting `GOOGLE_APPLICATION_CREDENTIALS` to a service account key also works.

**Access**

Any verified permission (owner, full or restricted user) can read performance data.

**Scope**

One connection opens one property. Enter `site_url` exactly as Search Console shows it, including the trailing `/` of URL-prefix properties. Set `search_type` to `image`, `video`, `news`, `discover` or `googleNews` for those reports; the default is `web`.

**Data**

Dates are in Pacific Time. Filter on Date to choose a range; without one, the last 28 days are queried. Search Console keeps about 16 months of data. Search appearance can only be grouped on its own, and Discover reports have no Query or Position.
