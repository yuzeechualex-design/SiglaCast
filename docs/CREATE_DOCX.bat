@echo off
echo Generating SiglaCast capstone DOCX...
py -3 "%~dp0generate_docx_stdlib.py"
if errorlevel 1 python "%~dp0generate_docx_stdlib.py"
echo.
echo Files should be at:
echo   %USERPROFILE%\Downloads\SiglaCast_ITP_Documentation.docx
echo   %~dp0SiglaCast_ITP_Documentation.docx
pause
