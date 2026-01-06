from openai import OpenAI
 
client = OpenAI(
    api_key="sk-Tidkx0v2rFknb-uOU6cw7g",  # không dùng, proxy không check
    base_url="http://172.19.16.23:4000/v1"
)
 
resp = client.chat.completions.create(
    model="gpt-4o",
    messages=[
        {"role": "system", "content": "You are a helpful assistant"},
        {"role": "user", "content": "hôm nay là thứ mấy?"}
    ]
)
 
print(resp.choices[0].message.content)