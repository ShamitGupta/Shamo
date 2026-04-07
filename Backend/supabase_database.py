import os
from dotenv import load_dotenv
from supabase import create_client, Client
from extractor import InformationExtracter,information_extraction

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
        
        print("Done")
        return response.data # Returns a list of matching documents
    except Exception as e:
        print(f"Error fetching from Supabase: {e}")
        return []

test = information_extraction("Can you please help me figure out how to do question 7 of the May June 2024 P21?")
    
output = retrieve_info(test)
print(len(output))
print(output)



