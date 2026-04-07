from fastapi import FastAPI
from extractor import information_extraction,PromptRequest
from fastapi.middleware.cors import CORSMiddleware

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
    output = information_extraction(data.user_prompt)
    return {'information': output}