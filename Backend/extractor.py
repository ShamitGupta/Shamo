from openai import OpenAI
from dotenv import load_dotenv
import os
from classes import InformationExtracter,PromptRequest,PromptResponse

load_dotenv()

#Initialize client
client = OpenAI(
    api_key=os.getenv("OPENAI_API_KEY")
)

system_prompt_extraction = """You are an expert extraction algorithm. Your job is to extract the relevant information based on a user query, which is about a particular question from a Past Paper. 

Here are some examples: 

User Query: I do not understand how to solve question 8 in  May June 2023 paper 11. 

The question_number will be 8, the paper_variant will be 11, the exam session with be May/June, and the year will be 2023."""




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

def user_response_stream(data:list, user_prompt:str):
    qp_data, ms_data = data[0],data[1]
    system_prompt_response = f"""You are a expert Mathematics tutor. Your job is to teach a user based on a IGCSE Add Maths Past Paper which they don't understand how to solve. 

Here is the question (in Latex): {qp_data}

Here is attached the Mark Scheme: {ms_data}

Note that the content in the Question and Mark Scheme contain some information which is slightly off topic. 

Always choose the relevant information according to what the user has asked, and reply accordingly. 

Always use single dollar signs for inline math (e.g. $x^2$) and double dollar signs for block math (e.g.$$y = mx + c$$).

Please use clear Markdown headers (###) for major sections. 
Use bold text for key terms and bullet points for steps to keep 
the response scannable and neat.

Please do not start solving the question in your methodology. If asked to solve the question, please refer to the Mark Scheme material provided, and analyze and explain that accordingly."""

    stream = client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": system_prompt_response},
            {"role": "user", "content": user_prompt}
        ],
        stream=True,
    )

    for chunk in stream:
        # Yield the text delta if it exists
        if chunk.choices[0].delta.content is not None:
            yield chunk.choices[0].delta.content
    
    


