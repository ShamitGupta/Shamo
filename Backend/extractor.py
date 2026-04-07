from openai import OpenAI
from dotenv import load_dotenv
import os
from pydantic import BaseModel

load_dotenv()

#Initialize client
client = OpenAI(
    api_key=os.getenv("OPENAI_API_KEY")
)

system_prompt = """You are an expert extraction algorithm. Your job is to extract the relevant information based on a user query, which is about a particular question from a Past Paper. 

Here are some examples: 

User Query: I do not understand how to solve question 8 in  May June 2023 paper 11. 

The question_number will be 8, the paper_variant will be 11, the exam session with be May/June, and the year will be 2023."""


class InformationExtracter(BaseModel):
    question_number: int
    Year: int
    Paper_Variant: int
    Exam_session: str

class PromptRequest(BaseModel):
    user_prompt: str


def information_extraction(user_prompt:str):
    response = client.responses.parse(
        model="gpt-4o",  # Use an existing model like gpt-4o or gpt-3.5-turbo
        input=[
            {
                "role": "system",
                "content": system_prompt,
            },
            {
                "role": "user",
                "content": user_prompt
            }
        ],
        text_format=InformationExtracter,
    )

    event = response.output_parsed
    # output = {'question_number': event.question_number, 'Year': event.Year, 'Paper_Variant': event.Paper_Variant, 'Exam_session': event.Exam_session}
    return event

# test = information_extraction('Can you please help me figure out how to do question 3 of the May June 2022 P11?')
# print(test)


