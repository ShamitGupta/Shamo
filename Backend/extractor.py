from openai import OpenAI
from dotenv import load_dotenv
import os
from pydantic import BaseModel

load_dotenv()

#Initialize client
client = OpenAI(
    api_key=os.getenv("OPENAI_API_KEY")
)

system_prompt_extraction = """You are an expert extraction algorithm. Your job is to extract the relevant information based on a user query, which is about a particular question from a Past Paper. 

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
                "content": system_prompt_extraction,
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

def user_response(data:list, user_prompt:str):
    qp_data, ms_data = data[0],data[1]
    system_prompt_response = f"""You are a expert Mathematics tutor. Your job is to teach a user based on a IGCSE Add Maths Past Paper which they don't understand how to solve. 

Here is the question (in Latex): {qp_data}

Here is attached the Mark Scheme: {ms_data}

Note that the content in the Question and Mark Scheme contain some information which is slightly off topic. 

Always choose the relevant information according to what the user has asked, and reply accordingly. 

Please do not start solving the question in your methodology. If asked to solve the question, please refer to the Mark Scheme material provided, and analyze and explain that accordingly."""

    response = client.responses.parse(
        model="gpt-4o",  # Use an existing model like gpt-4o or gpt-3.5-turbo
        input=[
            {
                "role": "system",
                "content": system_prompt_response,
            },
            {
                "role": "user",
                "content": user_prompt
            }
        ],
    )
    
    return response.output_text


# test = information_extraction('Can you please help me figure out how to do question 3 of the May June 2022 P11?')
# print(test)


