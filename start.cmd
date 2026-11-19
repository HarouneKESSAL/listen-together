@echo off
rem Starts Listen Together: room server (Docker), web server, and the permanent public link.
rem Friends open: https://harounekessal.github.io/listen-together/ (page on GitHub Pages; search + rooms come through ngrok below)
cd /d "%~dp0"
docker start metroserver >nul || (echo Docker isn't running or the metroserver container is missing. & pause & exit /b 1)
start "Listen Together web" node server.js
start "Listen Together link" ngrok http 5500 --url https://motion-tidal-june.ngrok-free.dev
echo Running. Share: https://harounekessal.github.io/listen-together/
echo Close the two new windows to stop.
timeout /t 5 >nul
