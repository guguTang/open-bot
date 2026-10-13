package httpserver

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	// maxInlineDocBytes is the per-file cap for MarkItDown text in the prompt.
	// Plain-text attachments stay at maxInlineTextBytes.
	maxInlineDocBytes = 80 << 10
	// maxDocParseResponseBytes bounds the sidecar JSON so a huge reply cannot
	// be buffered whole. The sidecar itself caps markdown (see MAX_RETURN_BYTES).
	maxDocParseResponseBytes = 1 << 20
)

var (
	// PDF/Office convert can exceed ~10s on cold start or multi-page files;
	// keep HTTP client Timeout slightly above the per-request context budget.
	docParseClient = &http.Client{
		Timeout: 65 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	docParseTimeout = 60 * time.Second
)

func officeExt(ext string) bool {
	switch ext {
	case ".pdf", ".docx", ".xlsx", ".pptx":
		return true
	default:
		return false
	}
}

func officeMIME(mt string) bool {
	switch mt {
	case "application/pdf",
		"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		"application/vnd.openxmlformats-officedocument.presentationml.presentation":
		return true
	default:
		return false
	}
}

func isOfficeAttachment(mimeType, filename string) bool {
	ext := strings.ToLower(filepath.Ext(filename))
	if officeExt(ext) {
		return true
	}
	if isTextLikeAttachment(mimeType, filename) {
		return false
	}
	mt := strings.ToLower(strings.TrimSpace(strings.Split(mimeType, ";")[0]))
	return officeMIME(mt)
}

func officeKindLabel(mimeType, filename string) string {
	ext := strings.ToLower(filepath.Ext(filename))
	mt := strings.ToLower(strings.TrimSpace(strings.Split(mimeType, ";")[0]))
	switch {
	case ext == ".docx" || mt == "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
		return "DOCX"
	case ext == ".xlsx" || mt == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
		return "XLSX"
	case ext == ".pptx" || mt == "application/vnd.openxmlformats-officedocument.presentationml.presentation":
		return "PPTX"
	default:
		return "PDF"
	}
}

func officeUploadName(name, mimeType string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		name = "file"
	}
	ext := strings.ToLower(filepath.Ext(name))
	if officeExt(ext) {
		return name
	}
	mt := strings.ToLower(strings.TrimSpace(strings.Split(mimeType, ";")[0]))
	switch mt {
	case "application/pdf":
		return name + ".pdf"
	case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
		return name + ".docx"
	case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
		return name + ".xlsx"
	case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
		return name + ".pptx"
	default:
		return name
	}
}

func officeParseNote(label, kind string) string {
	switch kind {
	case "unconfigured":
		return fmt.Sprintf("  （%s 已存储；未配置解析服务，无法解析正文）\n", label)
	case "timeout":
		return fmt.Sprintf("  （%s 解析超时，未得到正文）\n", label)
	case "unavailable":
		return fmt.Sprintf("  （%s 解析服务不可用，未得到正文）\n", label)
	case "canceled":
		return fmt.Sprintf("  （%s 解析已中断，未得到正文）\n", label)
	case "read":
		return "  （无法读取文件内容）\n"
	case "empty":
		if label == "PDF" {
			return "  （PDF 未提取到正文；若是扫描件，当前不支持 OCR）\n"
		}
		return fmt.Sprintf("  （%s 未提取到正文）\n", label)
	default:
		return fmt.Sprintf("  （%s 解析失败，未得到正文）\n", label)
	}
}

func docParseEndpoint() (string, string) {
	base := strings.TrimRight(strings.TrimSpace(os.Getenv("DOC_PARSE_URL")), "/")
	if base == "" {
		return "", "unconfigured"
	}
	u, err := url.Parse(base)
	if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") {
		log.Printf("doc parse: DOC_PARSE_URL must be an http(s) URL")
		return "", "unavailable"
	}
	return base + "/convert", ""
}

func isTimeoutErr(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return true
	}
	var ne net.Error
	return errors.As(err, &ne) && ne.Timeout()
}

func fetchDocumentMarkdown(ctx context.Context, absPath, filename, mimeType string) (markdown string, charCount int, truncated bool, kind string) {
	endpoint, kind := docParseEndpoint()
	if kind != "" {
		return "", 0, false, kind
	}
	ctx, cancel := context.WithTimeout(ctx, docParseTimeout)
	defer cancel()

	f, err := os.Open(absPath)
	if err != nil {
		return "", 0, false, "read"
	}
	defer f.Close()

	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	part, err := mw.CreateFormFile("file", filename)
	if err != nil {
		return "", 0, false, "failed"
	}
	if _, err := io.Copy(part, io.LimitReader(f, maxAttachmentBytes)); err != nil {
		return "", 0, false, "read"
	}
	if err := mw.Close(); err != nil {
		return "", 0, false, "failed"
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, &buf)
	if err != nil {
		return "", 0, false, "unavailable"
	}
	req.Header.Set("Content-Type", mw.FormDataContentType())
	resp, err := docParseClient.Do(req)
	if err != nil {
		switch {
		case isTimeoutErr(err):
			return "", 0, false, "timeout"
		case errors.Is(err, context.Canceled):
			return "", 0, false, "canceled"
		default:
			return "", 0, false, "unavailable"
		}
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxDocParseResponseBytes+1))
	if err != nil {
		if isTimeoutErr(err) {
			return "", 0, false, "timeout"
		}
		return "", 0, false, "unavailable"
	}
	if len(body) > maxDocParseResponseBytes {
		return "", 0, false, "failed"
	}
	switch resp.StatusCode {
	case http.StatusOK:
	case http.StatusGatewayTimeout, http.StatusRequestTimeout:
		return "", 0, false, "timeout"
	case http.StatusBadGateway, http.StatusServiceUnavailable:
		return "", 0, false, "unavailable"
	default:
		return "", 0, false, "failed"
	}

	var payload struct {
		Markdown  string `json:"markdown"`
		CharCount int    `json:"char_count"`
		Truncated bool   `json:"truncated"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return "", 0, false, "failed"
	}
	if strings.TrimSpace(payload.Markdown) == "" {
		return "", 0, false, "empty"
	}
	return payload.Markdown, payload.CharCount, payload.Truncated, ""
}

func truncateUTF8Bytes(s string, max int) (string, bool) {
	if len(s) <= max {
		return s, false
	}
	cut := s[:max]
	for len(cut) > 0 && !utf8.ValidString(cut) {
		cut = cut[:len(cut)-1]
	}
	return cut, true
}

func writeInlinedDocument(b *strings.Builder, markdown string, charCount int, sidecarTruncated bool) {
	fullRunes := charCount
	if fullRunes <= 0 {
		fullRunes = utf8.RuneCountInString(markdown)
	}
	body, cut := truncateUTF8Bytes(markdown, maxInlineDocBytes)
	if !utf8.ValidString(body) {
		body = strings.ToValidUTF8(body, "�")
	}
	b.WriteString("  以下为用户文件正文\n")
	fence := "```"
	for strings.Contains(body, fence) && len(fence) < 8 {
		fence += "`"
	}
	b.WriteString(fence)
	b.WriteString("markdown\n")
	b.WriteString(body)
	if !strings.HasSuffix(body, "\n") {
		b.WriteByte('\n')
	}
	b.WriteString(fence)
	b.WriteByte('\n')
	if cut || sidecarTruncated {
		b.WriteString(fmt.Sprintf("  （内容已截断，原文约 %d 字，仅保留前 %d KiB）\n", fullRunes, maxInlineDocBytes>>10))
	}
}

func appendOfficeDocument(ctx context.Context, b *strings.Builder, abs, name, mimeType string) {
	label := officeKindLabel(mimeType, name)
	filename := officeUploadName(name, mimeType)
	markdown, charCount, truncated, kind := fetchDocumentMarkdown(ctx, abs, filename, mimeType)
	if kind != "" {
		if kind != "unconfigured" {
			log.Printf("doc parse %s file=%s: %s", label, name, kind)
		}
		b.WriteString(officeParseNote(label, kind))
		return
	}
	writeInlinedDocument(b, markdown, charCount, truncated)
}
