from fastapi import FastAPI
from extractor import information_extraction
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


@app.get("/get_info")
def get_info():
    output = information_extraction('Can you please help me figure out how to do question 3 of the May June 2022 P11?')
    return output