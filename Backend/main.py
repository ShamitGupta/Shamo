from fastapi import FastAPI
from extractor import information_extraction,user_response_stream,PromptRequest,PromptResponse
from supabase_database import retrieve_info,format_data
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

app = FastAPI()

origins = [
    "http://localhost:5173",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def read_root():
    return {"Hello": "World"}


@app.post("/get_info")
def get_info(data: PromptRequest):
    extracted_info = information_extraction(data.user_prompt) #returns a InformationExtracter class
    unformatted_data = retrieve_info(extracted_info) #returns a python dict
    formatted_data = format_data(unformatted_data) #returns a list such that list[0] = qp_data and list[1] = ms_data

    # return StreamingResponse(
    #     user_response_stream(formatted_data, data.user_prompt), 
    #     media_type="text/plain"
    # )
    return {'past_paper_data':formatted_data}

@app.post("/get_response")
def get_response(data: PromptResponse):
    return StreamingResponse(
        user_response_stream(data.data_formatted, data.user_prompt), 
        media_type="text/plain"
    )