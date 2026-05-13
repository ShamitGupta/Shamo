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




def information_extraction(metadata: list):

    if(len(metadata) !=5):
        extracted_info = {}
    else:
        Subject,Year, Exam_session, Paper_Variant, question_number = metadata[0],metadata[1],metadata[2],metadata[3],metadata[4]
        #need to typecaste because all the data came in as Strings from the front-end, but backend stores many of these as integers
        extracted_info = {
            'Subject': Subject,
            'question_number':int(question_number),
            'Year':int(Year),
            'Paper_Variant': int(Paper_Variant),
            'Exam_session': Exam_session
        }

    return extracted_info

def user_response_stream(data:list, user_prompt:str, conversation_history:list | None = None):
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

Please do not start solving the question in your methodology. If asked to solve the question, please refer to the Mark Scheme material provided, and analyze and explain that accordingly.

If prior conversation history is provided, use it to maintain continuity with the student's latest questions and your earlier explanations."""

    chat_messages = [{"role": "system", "content": system_prompt_response}]

    if conversation_history:
        chat_messages.extend(
            {
                "role": message["role"],
                "content": message["content"]
            }
            for message in conversation_history
            if isinstance(message, dict)
            and message.get("role") in {"user", "assistant"}
            and isinstance(message.get("content"), str)
            and message["content"].strip()
        )

    chat_messages.append({"role": "user", "content": user_prompt})

    stream = client.chat.completions.create(
        model="gpt-4o",
        messages=chat_messages,
        stream=True,
    )

    for chunk in stream:
        # Yield the text delta if it exists
        if chunk.choices[0].delta.content is not None:
            yield chunk.choices[0].delta.content
    
    


