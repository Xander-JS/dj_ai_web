import os
from dotenv import load_dotenv
from google import genai

load_dotenv()

api_key = os.getenv("GEMINI_API_KEY")

if not api_key:
    print("❌ Error: No se encontró GEMINI_API_KEY en el archivo .env")
    exit(1)

try:
    client = genai.Client(api_key=api_key)
    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents="Responde únicamente: 'Conexión exitosa con Gemini Pro'."
    )
    print("✅", response.text.strip())
except Exception as e:
    print("❌ Error al conectar con Gemini:", e)