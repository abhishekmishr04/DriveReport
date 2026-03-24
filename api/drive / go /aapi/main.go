package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"

	"golang.org/x/oauth2/google"
	"google.golang.org/api/drive/v3"
	"google.golang.org/api/option"
)

type RequestBody struct {
	FileName   string `json:"fileName"`
	FileBase64 string `json:"fileBase64"`
	Data       string `json:"data"` // fallback support
}

func main() {
	http.HandleFunc("/api/drive", handler)
	fmt.Println("Server running on :8080")
	log.Fatal(http.ListenAndServe(":8080", nil))
}

func handler(w http.ResponseWriter, r *http.Request) {

	// CORS
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	action := r.URL.Query().Get("action")

	if action == "health" {
		json.NewEncoder(w).Encode(map[string]string{
			"status": "ok",
		})
		return
	}

	if action == "save" && r.Method == "POST" {
		saveFile(w, r)
		return
	}

	http.Error(w, "Unknown action", http.StatusNotFound)
}

func saveFile(w http.ResponseWriter, r *http.Request) {
	var body RequestBody

	err := json.NewDecoder(r.Body).Decode(&body)
	if err != nil {
		http.Error(w, "Invalid JSON", 400)
		return
	}

	fileBase64 := body.FileBase64

	// fallback if frontend sends "data"
	if fileBase64 == "" && body.Data != "" {
		fileBase64 = body.Data
	}

	if fileBase64 == "" {
		http.Error(w, "fileBase64 missing", 400)
		return
	}

	fileName := body.FileName
	if fileName == "" {
		fileName = "DSR-Report.xlsx"
	}

	// remove data prefix if exists
	if strings.Contains(fileBase64, "base64,") {
		parts := strings.Split(fileBase64, "base64,")
		fileBase64 = parts[1]
	}

	fileBytes, err := base64.StdEncoding.DecodeString(fileBase64)
	if err != nil {
		http.Error(w, "Invalid base64", 400)
		return
	}

	// 🔐 AUTH
	ctx := context.Background()

	saKey := os.Getenv("SA_KEY")
	saKey = strings.ReplaceAll(saKey, `\n`, "\n")

	config, err := google.JWTConfigFromJSON([]byte(saKey), drive.DriveScope)
	if err != nil {
		http.Error(w, "Auth config error", 500)
		return
	}

	client := config.Client(ctx)

	srv, err := drive.NewService(ctx, option.WithHTTPClient(client))
	if err != nil {
		http.Error(w, "Drive service error", 500)
		return
	}

	folderID := os.Getenv("FOLDER_ID")

	file := &drive.File{
		Name:     fileName,
		Parents:  []string{folderID},
		MimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	}

	res, err := srv.Files.Create(file).
		Media(bytes.NewReader(fileBytes)).
		Do()

	if err != nil {
		http.Error(w, "Upload failed: "+err.Error(), 500)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"fileId":  res.Id,
	})
}
