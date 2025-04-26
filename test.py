import requests

def test_pipeline_api():
    url = "http://localhost:5000/api/agent/generate-chart"

    # Prepare the data file and prompt
    files = {
        'file': ('data.csv', open('data.csv', 'rb'), 'text/csv')
    }
    data = {
        'prompt': 'Generate a bar chart showing sales trends over the last year.'
    }

    # Make the API request
    response = requests.post(url, files=files, data=data)

    # Print the response
    if response.status_code == 200:
        print("Chart generated successfully:")
        print(response.json())
    else:
        print(f"Failed to generate chart. Status code: {response.status_code}")
        print(response.text)

if __name__ == "__main__":
    test_pipeline_api()