@echo off
REM ==========================================================
REM  MED-EXPERT - Bam dup vao file nay de chay toan bo he thong
REM ==========================================================
chcp 65001 >nul
title MED-EXPERT - He Co So Tri Thuc Y Te
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [LOI] May chua cai Node.js.
  echo       Hay tai va cai ban LTS tai: https://nodejs.org
  echo       Cai xong thi bam dup lai file start.bat.
  pause
  exit /b 1
)

node --no-warnings khoi_dong.js
if errorlevel 1 pause
