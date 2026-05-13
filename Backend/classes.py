from pydantic import BaseModel, Field

class InformationExtracter(BaseModel):
    question_number: int
    Year: int
    Paper_Variant: int
    Exam_session: str

class PromptRequest(BaseModel):
    user_prompt: str
    metadata: list

class PromptResponse(BaseModel):
    data_formatted: list
    user_prompt: str
    conversation_history: list = Field(default_factory=list)
