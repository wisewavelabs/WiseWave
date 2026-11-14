package presentation

import (
	"fmt"
	"github.com/egoist/mygo"
	"html"
	"strings"
)

func StatusHTML(title, label, accent string) string {
	return strings.ReplaceAll(fmt.Sprintf(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>%s</title>
  <style>
    body {
      background-color: #121212;
      margin: 0;
      padding: 0;
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      color: #b3b3b3;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      overflow: hidden;
      user-select: none;
    }

    .loading-container {
      text-align: center;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 20px;
    }

    .spinner {
      position: relative;
      width: 48px;
      height: 48px;
    }

    .spinner-inner {
      box-sizing: border-box;
      display: block;
      position: absolute;
      width: 40px;
      height: 40px;
      margin: 4px;
      border: 3px solid transparent;
      border-radius: 50%%;
      animation: spin 1.2s cubic-bezier(0.5, 0, 0.5, 1) infinite;
      border-top-color: #1db954;
    }

    .spinner-inner:nth-child(1) { animation-delay: -0.45s; }
    .spinner-inner:nth-child(2) { animation-delay: -0.3s; }
    .spinner-inner:nth-child(3) { animation-delay: -0.15s; }

    @keyframes spin {
      0%% { transform: rotate(0deg); }
      100%% { transform: rotate(360deg); }
    }

    .shimmer-text {
      font-size: 17px;
      line-height: 22px;
      font-weight: 500;
      color: transparent;
      -webkit-text-fill-color: transparent;
      background: linear-gradient(
        90deg,
        #a1a1a1 0%%,
        #a1a1a1 30%%,
        rgba(161, 161, 161, 0.45) 45%%,
        rgba(161, 161, 161, 0.45) 55%%,
        #a1a1a1 70%%,
        #a1a1a1 100%%
      );
      background-size: 300%% 100%%;
      -webkit-background-clip: text;
      background-clip: text;
      animation: label-shine 2.25s cubic-bezier(0.25, 0.1, 0.25, 1) infinite;
    }

    @keyframes label-shine {
      0%%, 18%% { background-position: 100%% 0; }
      82%%, 100%% { background-position: 0%% 0; }
    }

    .shimmer-text::after {
      content: "...";
      display: inline-block;
      width: 0ch;
      overflow: hidden;
      text-align: left;
      vertical-align: bottom;
      animation: dots 1.6s steps(4, end) infinite;
    }

    @keyframes dots {
      to { width: 3ch; }
    }
  </style>
</head>
<body>
  <div class="loading-container" role="status" aria-live="polite">
    <div class="spinner" aria-hidden="true">
      <div class="spinner-inner"></div>
      <div class="spinner-inner"></div>
      <div class="spinner-inner"></div>
    </div>
    <div class="shimmer-text">%s</div>
  </div>
</body>
</html>`, html.EscapeString(title), html.EscapeString(label)), "#1db954", accent)
}

func WindowOptions(title, address, background string, session *mygo.Session) mygo.WindowOptions {
	return mygo.WindowOptions{Title: title, Width: 480, Height: 700, MinWidth: 420, MinHeight: 600, MaxWidth: 560, MaxHeight: 820, DisableMaximize: true, URL: address, BackgroundColor: background, Page: mygo.PageOptions{Session: session, Untrusted: true}}
}
