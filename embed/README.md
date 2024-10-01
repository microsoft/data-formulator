# Embed Data Formulator

First you'll need to build the bundle:
```
yarn build
```

This puts the complete js file in the `dist` folder.

## Test bundle

Next you can test to see the complete Data Formulator app by opening `/embed/index.html` in your browser. You can do this by double-clicking in your file explorer (this would use the `file://` protocol). 

To test cross-frame messaging, launch `postMessageTest.html` which hosts the app in an iframe, and has buttons to send commands such as `load data`.

## Use in Fabric Notebook

You willl need to enable access to your `dist` from the cloud. There are 2 ways to do this:
* Publish the `dist` (e.g. pip, npm, or other)
* Create a tunnel to your localhost

### Tunnel to localhost
One way is to install [local-web-server](https://www.npmjs.com/package/local-web-server). This will serve a local folder as a website on http://localhost:8000. Next, you can set up a tunnel such as [ngrok](https://ngrok.com/download) which can provide a cloud-accesible url proxy to your local server.

Copy the python function in a notebook cell:
```py
def dfviz(df, tableName, serverUrl):
    # df is a PySpark DataFrame

    import json
    from datetime import date, datetime

    # Custom function to convert datetime objects to string
    def json_serial(obj):
        if isinstance(obj, (datetime, date)):
            return obj.isoformat()
        raise TypeError ("Type %s not serializable" % type(obj))

    # Convert DataFrame rows to dictionaries and collect them into a list
    data = [row.asDict() for row in df.collect()]

    # Convert list of dictionaries to a single JSON array using the custom function
    json_data = json.dumps(data, default=json_serial)

    displayHTML(f"""<!DOCTYPE html>
<meta charset="utf-8">
<script>
    const table = {json_data};
    const embedPromise = new Promise((resolve, reject) => {{
        const embedIframe = document.createElement('iframe');
        embedIframe.style.height = '700px';
        embedIframe.style.width = 'calc(100% - 4px)';
        document.body.appendChild(embedIframe);
        const closeScriptTag = '</'+'script>';
        const htmlContent = `<!DOCTYPE html>
<html><body>
    <div id="root"></div>
    <script src="{serverUrl}/DataFormulator.js" defer onload="parent.frameLoaded()" onerror="parent.frameError()">${{closeScriptTag}}
</body></html>`;

        // Define global functions for onload and onerror events of the script
        window.frameLoaded = () => resolve(embedIframe);
        window.frameError = () => reject(new Error('Script failed to load'));

        // Write the HTML content to the iframe
        embedIframe.contentWindow.document.open();
        embedIframe.contentWindow.document.write(htmlContent);
        embedIframe.contentWindow.document.close();
    }});
    embedPromise.then((embedIframe) => {{
        embedIframe.contentWindow.postMessage({{ actionName: 'setConfig', actionParams: {{ serverUrl: '{serverUrl}', popupConfig: {{ allowPopup: true, jsUrl: '{serverUrl}/DataFormulator.js' }} }} }}, '*');
        embedIframe.contentWindow.postMessage({{ actionName: 'loadData', actionParams: {{ tableName: '{tableName}', table }} }}, '*');
    }});
</script>
"""
)
```

Get a dataframe and pass it to the `dfviz` function:
```py
df = spark.sql("SELECT * FROM Sample_lakehouse_475.publicholidays LIMIT 100")
display(df)
dfviz(df, 'Holidays', 'https://<your_tunnel_url>')
```

