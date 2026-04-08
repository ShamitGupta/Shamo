import os
from dotenv import load_dotenv
from supabase import create_client, Client
from extractor import information_extraction
from classes import InformationExtracter,PromptRequest,PromptResponse

load_dotenv()

url: str = os.getenv("SUPABASE_URL")
key: str = os.getenv("SUPABASE_KEY")
supabase: Client = create_client(url, key)


def retrieve_info(metadata: InformationExtracter):
    search_criteria = {
        "question_numbers": [metadata.question_number],
        "Year": metadata.Year,
        "Paper_Variant": metadata.Paper_Variant,
        "Exam_session": metadata.Exam_session
    }

    try:
        response = supabase.table("documents") \
            .select("content,metadata") \
            .contains("metadata", search_criteria) \
            .execute()
        
        return response.data # Returns a list of matching documents
    except Exception as e:
        print(f"Error fetching from Supabase: {e}")
        return []
    
def format_data(retrieved_data: dict):
    qp_data = ""
    ms_data = ""

    for i in range(len(retrieved_data)):
        if(retrieved_data[i].get("metadata").get("Document_type") == "Question Paper"):
            qp_data += retrieved_data[i].get("content")
        
        if(retrieved_data[i].get("metadata").get("Document_type") == "Mark Scheme"):
            ms_data += retrieved_data[i].get("content")
    
    return [qp_data,ms_data]