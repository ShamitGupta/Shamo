import os
from dotenv import load_dotenv
from supabase import create_client, Client
from extractor import InformationExtracter

load_dotenv()

url: str = os.getenv("SUPABASE_URL")
key: str = os.getenv("SUPABASE_KEY")
supabase: Client = create_client(url, key)


def retrieve_info(metadata: InformationExtracter):
    search_criteria = {
        "question_number":InformationExtracter.question_number,
        "Year": InformationExtracter.Year,
        "Paper_Variant": InformationExtracter.Paper_Variant,
        "Exam_session": InformationExtracter.Exam_session
    }

    try:
        response = supabase.table("documents") \
            .select("*") \
            .contains("metadata", search_criteria) \
            .execute()
        
        return response.data # Returns a list of matching documents
    except Exception as e:
        print(f"Error fetching from Supabase: {e}")
        return []


