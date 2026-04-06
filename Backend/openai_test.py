from openai import OpenAI
from dotenv import load_dotenv, dotenv_values
import os


load_dotenv()
client = OpenAI(
    api_key= os.getenv("OPENAI_API_KEY")
)

response = client.responses.create(
    model="gpt-5.4",
    input="Write a one-sentence bedtime story about a unicorn."
)

print(response.output_text)