from flask import Flask, request, jsonify
from flask_cors import CORS
import os
from werkzeug.utils import secure_filename
from agent_level import DocumentAgent

app = Flask(__name__)

# Complete CORS configuration
CORS(app, resources={
    r"/*": {
        "origins": ["*"],
        "methods": ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        "allow_headers": ["Content-Type", "Authorization"]
    }
})

app.config['UPLOAD_FOLDER'] = './uploads'
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024

# Ensure upload directory exists
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

# Initialize the agent
groq_api_key = os.getenv("GROQ_API_KEY") 
agent = DocumentAgent(groq_api_key)

# Store active sessions
active_sessions = {}

# Add test endpoint
@app.route('/', methods=['GET'])
def test():
    return jsonify({'message': 'API is working!', 'status': 'OK'})

# Handle preflight requests
@app.before_request
def handle_preflight():
    if request.method == "OPTIONS":
        response = jsonify({'status': 'OK'})
        response.headers.add("Access-Control-Allow-Origin", "*")
        response.headers.add('Access-Control-Allow-Headers', "Content-Type,Authorization")
        response.headers.add('Access-Control-Allow-Methods', "GET,PUT,POST,DELETE,OPTIONS")
        return response

@app.route('/upload', methods=['POST', 'OPTIONS'])
def upload_document():
    try:
        if 'file' not in request.files:
            response = jsonify({'error': 'No file provided'})
            response.headers.add("Access-Control-Allow-Origin", "*")
            return response, 400
        
        file = request.files['file']
        if file.filename == '':
            response = jsonify({'error': 'No file selected'})
            response.headers.add("Access-Control-Allow-Origin", "*")
            return response, 400
        
        # Save uploaded file
        filename = secure_filename(file.filename)
        file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(file_path)
        
        # Process document
        result = agent.process(file_path)
        
        if result['status'] == 'completed':
            response = jsonify({
                'message': 'Document processed successfully',
                'collection_name': result['collection_name'],
                'status': 'success'
            })
            response.headers.add("Access-Control-Allow-Origin", "*")
            return response, 200
        else:
            response = jsonify({
                'error': result['error'],
                'status': 'failed'
            })
            response.headers.add("Access-Control-Allow-Origin", "*")
            return response, 500
            
    except Exception as e:
        response = jsonify({'error': str(e)})
        response.headers.add("Access-Control-Allow-Origin", "*")
        return response, 500

@app.route('/chat', methods=['POST', 'OPTIONS'])
def chat():
    try:
        data = request.get_json()
        query = data.get('query')
        collection_name = data.get('collection_name')
        session_id = data.get('session_id', 'default')
        
        if not query:
            response = jsonify({'error': 'Query is required'})
            response.headers.add("Access-Control-Allow-Origin", "*")
            return response, 400
        
        # Get or create thread_id for this session
        if session_id not in active_sessions:
            active_sessions[session_id] = {
                'thread_id': None,
                'collection_name': collection_name or agent.current_collection,
                'chat_history': []
            }
        
        session = active_sessions[session_id]
        
        # Use collection from session if not provided
        if not collection_name:
            collection_name = session['collection_name']
        
        # Chat with document
        result = agent.chat(
            query=query, 
            collection_name=collection_name,
            thread_id=session['thread_id']
        )
        
        # Update session
        session['thread_id'] = result['thread_id']
        session['chat_history'].append({
            'query': query,
            'response': result['response']
        })
        
        response = jsonify({
            'response': result['response'],
            'sources': result['sources'],
            'session_id': session_id,
            'thread_id': result['thread_id'],
            'chat_history': session['chat_history']
        })
        response.headers.add("Access-Control-Allow-Origin", "*")
        return response, 200
        
    except Exception as e:
        response = jsonify({'error': str(e)})
        response.headers.add("Access-Control-Allow-Origin", "*")
        return response, 500

if __name__ == '__main__':
    print("Starting Flask API server...")
    print("API will be available at: http://localhost:5000")
    app.run(debug=True, host='0.0.0.0', port=5000)