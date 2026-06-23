@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo  ====================================
echo    מרכז הערוצים שלי - שרת מקומי
echo  ====================================
echo.
echo  פותח בכתובת: http://localhost:8080
echo  לעצירה: Ctrl+C
echo.
start "" http://localhost:8080
python -m http.server 8080
