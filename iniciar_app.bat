@echo off
chcp 65001 >nul
title Video Merger Studio
cd /d "%~dp0"

echo ========================================================
echo         VIDEO MERGER STUDIO - INICIANDO APP
echo ========================================================
echo.

where python >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] No se ha encontrado Python instalado en el sistema.
    echo Por favor instala Python desde https://www.python.org/
    pause
    exit /b 1
)

echo [1/2] Verificando dependencias necesarias...
python -c "import fastapi, uvicorn, imageio_ffmpeg, multipart" >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo Instalando paquetes necesarios (FastAPI, FFmpeg)...
    python -m pip install -r requirements.txt
)

echo.
echo [2/2] Lanzando servidor y abriendo interfaz...
echo La aplicacion se abrira en tu navegador predeterminado: http://127.0.0.1:8000
echo Para cerrar la aplicacion, simplemente cierra esta ventana.
echo.

python main.py

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [AVISO] La aplicacion se ha detenido.
    pause
)
