from openai import OpenAI
from dotenv import load_dotenv, dotenv_values
client = OpenAI()

response = client.responses.create(
    model="gpt-5.4",
    input="Write a one-sentence bedtime story about a unicorn."
)

print(response.output_text)