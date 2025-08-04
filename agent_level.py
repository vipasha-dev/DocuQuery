import os
import uuid
from typing import TypedDict, List, Dict, Any
from langgraph.graph import StateGraph, END
from langgraph.checkpoint.sqlite import SqliteSaver
import chromadb
from text_extrtaction import DocumentProcessor
from groq import Groq
from dotenv import load_dotenv
import sqlite3
import re

load_dotenv()
groq_api_key = os.getenv("GROQ_API_KEY") 

class AgentState(TypedDict):
    file_path: str
    extracted_text: str
    collection_name: str
    query: str
    response: str
    sources: List[Dict[str, Any]]
    context: str
    status: str
    error: str
    mode: str

class DocumentAgent:
    def __init__(self, groq_api_key: str, db_path: str = "./chroma_db", checkpoint_path: str = "./checkpoints.db"):
        self.client = chromadb.PersistentClient(path=db_path)
        self.groq_client = Groq(api_key=groq_api_key)
        conn = sqlite3.connect(checkpoint_path, check_same_thread=False)
        self.checkpointer = SqliteSaver(conn)
        self.graph = self._build_graph()
        self.chat_graph = None
        self.current_collection = None  

    def generate_collection_name(self, file_path: str) -> str:
        """Generate unique collection name based on file"""
        filename = os.path.basename(file_path)
        base_name = os.path.splitext(filename)[0]
        safe_name = ''.join(c if c.isalnum() else '_' for c in base_name)
        timestamp = str(uuid.uuid4().hex[:8])
        return f"{safe_name}_{timestamp}".lower()

    def extract_text(self, state: AgentState) -> AgentState:
        """Extract text from document"""
        try:
            print(f"Extracting text from {state['file_path']}")
            processor = DocumentProcessor(state['file_path'])
            text = processor.process_file(use_table_aware=True)
            print(f"extracted text:{text}")
            
            if not text:
                state['status'] = "failed"
                state['error'] = "No text extracted"
                return state
                
            state['extracted_text'] = text
            state['status'] = 'extracted'
            print(f"Extracted {len(text)} characters")
            return state
        except Exception as e:
            state['status'] = "failed"
            state['error'] = str(e)
            return state

    def store_in_db(self, state: AgentState) -> AgentState:
        """Store text chunks in chromadb with overlapping chunks"""
        try:
            print(f"Storing in chromadb collection: {state['collection_name']}")
            collection = self.client.get_or_create_collection(state['collection_name'])

            text = state['extracted_text']
            chunk_size = 1000
            chunk_overlap = 200

            chunks = []
            for i in range(0, len(text), chunk_size - chunk_overlap):
                chunk = text[i:i + chunk_size]
                if chunk:
                    chunks.append(chunk)

            for i, chunk in enumerate(chunks):
                collection.add(
                    documents=[chunk],
                    ids=[f"{os.path.basename(state['file_path'])}_{uuid.uuid4().hex[:8]}_{i}"],
                    metadatas=[{"source": state['file_path'], "chunk": i}]
                )

            state['status'] = 'completed'
            print(f"Stored {len(chunks)} chunks with overlap")
            return state

        except Exception as e:
            state['status'] = 'failed'
            state['error'] = str(e)
            return state

    def retrieve_context(self, state: AgentState) -> AgentState:
        """Retrieve relevant context from text"""
        try:
            print(f"Retrieving context from collection: {state['collection_name']}")
            collection = self.client.get_collection(state['collection_name'])
            results = collection.query(query_texts=[state['query']], n_results=3)
            
            sources = []
            context_text = ""

            if results['documents'] and results['documents'][0]:
                for i, (doc, metadata) in enumerate(zip(results['documents'][0], results['metadatas'][0])):
                    sources.append({
                        'chunk_id': results['ids'][0][i],
                        'text': doc,
                        'metadata': metadata
                    })
                    context_text += f"\n{doc}\n"

            state['sources'] = sources
            state['context'] = context_text
            state['status'] = 'context_retrieved'
            return state

        except Exception as e:
            state['status'] = 'failed'
            state['error'] = f"Context retrieval failed: {str(e)}"
            return state

    def generate_response(self, state: AgentState) -> AgentState:
        """Generate chat response using Deepseek"""
        try:
            print("Generating response")
            prompt = f"""You are a helpful assistant that answers user queries based only on the provided document. Document can be a research paper, technical manual, or any other text.

    Manual Content:
    {state['context']}

    User Question:
    {state['query']}

    Instructions:
    - Use only the information from the document to answer.
    - Respond in clear, user-friendly paragraphs.
    - Do not mention chunks, sections, or internal document markers.
    - Avoid adding assumptions or information not present in the manual.
    - Provide a complete, natural explanation as if guiding a user.

    Answer:"""

            response = self.groq_client.chat.completions.create(
                model="deepseek-r1-distill-llama-70b",
                messages=[
                    {"role": "system", "content": "You are an assistant that answers questions using product manual content. Provide clear, helpful answers based strictly on the provided manual."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.1,
                max_tokens=1500
            )

            raw_response = response.choices[0].message.content
            
            clean_response = re.sub(r'<think>.*?</think>', '', raw_response, flags=re.DOTALL)
            clean_response = re.sub(r'\bchunk\s+\d+[,\s]*', '', clean_response, flags=re.IGNORECASE)
            clean_response = re.sub(r'\([^)]*chunk[^)]*\)', '', clean_response, flags=re.IGNORECASE)
            clean_response = re.sub(r'\n\s*\n', '\n\n', clean_response.strip())

            state['response'] = clean_response
            state['status'] = 'completed'
            return state

        except Exception as e:
            state['status'] = 'failed'
            state['error'] = f"Response generation failed: {str(e)}"
            return state

    def _build_graph(self):
        workflow = StateGraph(AgentState)
        workflow.add_node("extract", self.extract_text)
        workflow.add_node("store", self.store_in_db)
        workflow.set_entry_point("extract")
        workflow.add_conditional_edges(
            "extract",
            lambda state: "store" if state["status"] == "extracted" else END,
            {"store": "store", END: END}
        )
        workflow.add_edge("store", END)
        return workflow.compile()

    def process(self, file_path: str, collection_name: str = None):
        """Process document with unique collection name"""
        if collection_name is None:
            collection_name = self.generate_collection_name(file_path)
        
        print(f"Processing file into collection: {collection_name}")
        
        state = AgentState(
            file_path=file_path,
            extracted_text="",
            collection_name=collection_name,
            query="",
            response="",
            sources=[],
            context="",
            status="starting",
            error="",
            mode="process"
        )
        
        result = self.graph.invoke(state)
        
        if result['status'] == 'completed':
            self.current_collection = collection_name  
            print(f'Document processing completed! Active collection: {collection_name}')
        else:
            print(f"Processing failed: {result['error']}")
        
        return result

    def chat(self, query: str, collection_name: str = None, thread_id: str = None):
        """Chat with specific document collection"""
        if collection_name is None:
            if self.current_collection is None:
                return {
                    'response': "No document processed yet. Please process a document first.",
                    'sources': [],
                    'thread_id': thread_id
                }
            collection_name = self.current_collection
        
        if thread_id is None:
            thread_id = str(uuid.uuid4())
        
        print(f"Processing query: {query} in collection: {collection_name}")

        if self.chat_graph is None:
            chat_workflow = StateGraph(AgentState)
            chat_workflow.add_node("retrieve", self.retrieve_context)
            chat_workflow.add_node("generate", self.generate_response)
            chat_workflow.set_entry_point("retrieve")
            chat_workflow.add_conditional_edges(
                "retrieve",
                lambda state: "generate" if state['status'] == "context_retrieved" else END,
                {"generate": "generate", END: END}
            )
            chat_workflow.add_edge("generate", END)
            self.chat_graph = chat_workflow.compile(checkpointer=self.checkpointer)
        
        state = AgentState(
            file_path="",
            extracted_text="",
            collection_name=collection_name,
            query=query,
            response="",
            sources=[],
            context="",
            status="starting",
            error="",
            mode="chat"
        )
        
        config = {"configurable": {"thread_id": thread_id}}
        result = self.chat_graph.invoke(state, config=config)
        
        if result['status'] == 'completed':
            return {
                'response': result['response'],
                'sources': result['sources'],
                'thread_id': thread_id
            }
        else:
            return {
                'response': f"Error: {result['error']}",
                'sources': [],
                'thread_id': thread_id
            }
            
    def format_response(self, chat_result: Dict[str, Any]) -> str:
        """Format response with sources"""
        response = chat_result['response']
        sources = chat_result['sources']
        
        formatted = f"**Answer:** {response}\n\n**Sources:**\n"
        for i, source in enumerate(sources, 1):
            formatted += f"\n**Source {i}:** {source['text']}\n"
        
        return formatted

if __name__ == "__main__":
    if not groq_api_key:
        print("Error: GROQ_API_KEY not found in environment variables!")
        exit(1)
    
    agent = DocumentAgent(groq_api_key)
    
    file_path = r"C:\Users\sspl1431\Downloads\f0457fd050a9dc4d5cfaa750ed1ee39d84c8.pdf"
    
    print("Processing document...")
    doc_result = agent.process(file_path)
    
    if doc_result['status'] == 'completed':
        print("Document processed successfully! Starting chat...")
        print(f"Active collection: {agent.current_collection}")
        
        thread_id = None
        
        while True:
            query = input("\nAsk a question, 'list' for collections, 'switch <collection>' to change, or 'quit': ")
            
            if query.lower() == 'quit':
                break
            elif query.lower() == 'list':
                agent.list_collections()
                continue
            elif query.lower().startswith('switch '):
                collection_name = query[7:].strip()
                agent.switch_collection(collection_name)
                continue
            
            result = agent.chat(query, thread_id=thread_id)
            thread_id = result['thread_id']
            
            print(f"\n{agent.format_response(result)}")
    else:
        print(f"Processing failed: {doc_result['error']}")