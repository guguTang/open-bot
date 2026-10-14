package httpserver

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
	"unicode/utf8"
)

func TestAttachmentAllowedOffice(t *testing.T) {
	cases := []struct {
		mime, name string
		ok         bool
	}{
		{"application/pdf", "a.pdf", true},
		{"application/octet-stream", "notes.docx", true},
		{"application/vnd.openxmlformats-officedocument.wordprocessingml.document", "a.docx", true},
		{"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "sheet.xlsx", true},
		{"application/vnd.ms-excel", "legacy.xls", true},
		{"application/octet-stream", "legacy.xls", true},
		{"application/vnd.openxmlformats-officedocument.presentationml.presentation", "deck.pptx", true},
		{"application/vnd.openxmlformats-officedocument.presentationml.presentation", "deck.bin", true},
		{"application/msword", "old.doc", false},
		{"application/zip", "bundle.zip", false},
		{"application/octet-stream", "malware.exe", false},
		{"text/plain", "notes.txt", true},
	}
	for _, tc := range cases {
		if got := attachmentAllowed(tc.mime, tc.name); got != tc.ok {
			t.Errorf("attachmentAllowed(%q, %q)=%v want %v", tc.mime, tc.name, got, tc.ok)
		}
	}
}

func putUpload(t *testing.T, name, mime string, body []byte) (string, string, AttachmentRef) {
	t.Helper()
	root := t.TempDir()
	t.Setenv("OPENBOT_UPLOAD_ROOT", root)
	uid, conv := "user1", "conv1"
	id := "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
	relDir := filepath.Join(uid, conv)
	if err := os.MkdirAll(filepath.Join(root, relDir), 0o755); err != nil {
		t.Fatal(err)
	}
	stored := id + "_" + name
	if err := os.WriteFile(filepath.Join(root, relDir, stored), body, 0o644); err != nil {
		t.Fatal(err)
	}
	return uid, conv, AttachmentRef{
		ID:   id,
		Name: name,
		Mime: mime,
		Size: int64(len(body)),
		Path: filepath.ToSlash(filepath.Join(relDir, stored)),
	}
}

func useDocParseClient(t *testing.T, timeout time.Duration) time.Duration {
	t.Helper()
	prevC := docParseClient
	docParseClient = &http.Client{Timeout: timeout + 2*time.Second}
	t.Cleanup(func() {
		docParseClient = prevC
	})
	return timeout
}

func TestBuildUserContentDocxConverted(t *testing.T) {
	payload := []byte("PK\x03\x04docx-bytes")
	var gotName string
	var gotBody []byte
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/convert" || r.Method != http.MethodPost {
			t.Errorf("request %s %s", r.Method, r.URL.Path)
		}
		if err := r.ParseMultipartForm(1 << 20); err != nil {
			t.Errorf("multipart: %v", err)
			http.Error(w, "bad", http.StatusBadRequest)
			return
		}
		f, hdr, err := r.FormFile("file")
		if err != nil {
			t.Errorf("file: %v", err)
			return
		}
		defer f.Close()
		gotName = hdr.Filename
		gotBody, _ = io.ReadAll(f)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"markdown":"# 标题\n\n你好","filename":"notes.docx","char_count":6,"truncated":false}`))
	}))
	defer srv.Close()
	t.Setenv("DOC_PARSE_URL", srv.URL)
	timeout := useDocParseClient(t, 2*time.Second)

	uid, conv, ref := putUpload(t, "notes.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", payload)
	out, _, err := buildUserContentWithAttachments(context.Background(), "请总结", uid, conv, []AttachmentRef{ref}, timeout)
	if err != nil {
		t.Fatal(err)
	}
	if gotName != "notes.docx" {
		t.Fatalf("filename %q", gotName)
	}
	if string(gotBody) != string(payload) {
		t.Fatalf("body %q", gotBody)
	}
	if !strings.Contains(out, "请总结") || !strings.Contains(out, "以下为用户文件正文") {
		t.Fatalf("missing marker: %s", out)
	}
	if !strings.Contains(out, "# 标题") || !strings.Contains(out, "你好") {
		t.Fatalf("missing markdown: %s", out)
	}
	if strings.Contains(out, "未配置") || strings.Contains(out, "解析失败") {
		t.Fatalf("unexpected failure note: %s", out)
	}
}

func TestBuildUserContentPDFUnconfigured(t *testing.T) {
	t.Setenv("DOC_PARSE_URL", "")
	uid, conv, ref := putUpload(t, "scan.pdf", "application/octet-stream", []byte("%PDF-1.4"))
	out, _, err := buildUserContentWithAttachments(context.Background(), "", uid, conv, []AttachmentRef{ref}, 0)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, "未配置解析服务，无法解析正文") {
		t.Fatalf("got %s", out)
	}
	if strings.Contains(out, "%PDF") {
		t.Fatalf("raw pdf leaked: %s", out)
	}
}

func TestBuildUserContentConvertFailureDoesNotInvent(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, `{"error":"boom secret"}`, http.StatusUnprocessableEntity)
	}))
	defer srv.Close()
	t.Setenv("DOC_PARSE_URL", srv.URL)
	timeout := useDocParseClient(t, 2*time.Second)
	uid, conv, ref := putUpload(t, "notes.docx", "application/octet-stream", []byte("PK"))
	out, _, err := buildUserContentWithAttachments(context.Background(), "", uid, conv, []AttachmentRef{ref}, timeout)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, "DOCX 解析失败，未得到正文") {
		t.Fatalf("got %s", out)
	}
	if strings.Contains(out, "boom") || strings.Contains(out, "secret") {
		t.Fatalf("server error leaked: %s", out)
	}
}

func TestBuildUserContentConvertUnavailable(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "down", http.StatusServiceUnavailable)
	}))
	defer srv.Close()
	t.Setenv("DOC_PARSE_URL", srv.URL)
	timeout := useDocParseClient(t, 2*time.Second)
	uid, conv, ref := putUpload(t, "sheet.xlsx", "application/octet-stream", []byte("PK"))
	out, _, err := buildUserContentWithAttachments(context.Background(), "", uid, conv, []AttachmentRef{ref}, timeout)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, "XLSX 解析服务不可用，未得到正文") {
		t.Fatalf("got %s", out)
	}
}

func TestBuildUserContentConvertTimeout(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		timer := time.NewTimer(5 * time.Second)
		defer timer.Stop()
		select {
		case <-r.Context().Done():
			return
		case <-timer.C:
			w.WriteHeader(http.StatusOK)
		}
	}))
	defer srv.Close()
	t.Setenv("DOC_PARSE_URL", srv.URL)
	timeout := useDocParseClient(t, 200*time.Millisecond)
	uid, conv, ref := putUpload(t, "deck.pptx", "application/octet-stream", []byte("PK"))
	start := time.Now()
	out, _, err := buildUserContentWithAttachments(context.Background(), "", uid, conv, []AttachmentRef{ref}, timeout)
	if err != nil {
		t.Fatal(err)
	}
	if time.Since(start) > 3*time.Second {
		t.Fatalf("timeout too slow: %s", time.Since(start))
	}
	if !strings.Contains(out, "PPTX 解析超时，未得到正文") {
		t.Fatalf("got %s", out)
	}
}

func TestBuildUserContentEmptyPDF(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"markdown":"  \n","filename":"scan.pdf","char_count":0,"truncated":false}`)
	}))
	defer srv.Close()
	t.Setenv("DOC_PARSE_URL", srv.URL)
	timeout := useDocParseClient(t, 2*time.Second)
	uid, conv, ref := putUpload(t, "scan.pdf", "application/pdf", []byte("%PDF"))
	out, _, err := buildUserContentWithAttachments(context.Background(), "", uid, conv, []AttachmentRef{ref}, timeout)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, "未提取到正文") || !strings.Contains(out, "扫描件") {
		t.Fatalf("got %s", out)
	}
	if strings.Contains(out, "以下为用户文件正文") {
		t.Fatalf("empty body was inlined: %s", out)
	}
}

func TestBuildUserContentTruncatesMarkdown(t *testing.T) {
	full := strings.Repeat("中", 30000)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"markdown":"`+full+`","filename":"a.docx","char_count":30000,"truncated":false}`)
	}))
	defer srv.Close()
	t.Setenv("DOC_PARSE_URL", srv.URL)
	timeout := useDocParseClient(t, 2*time.Second)
	uid, conv, ref := putUpload(t, "a.docx", "application/octet-stream", []byte("PK"))
	out, _, err := buildUserContentWithAttachments(context.Background(), "", uid, conv, []AttachmentRef{ref}, timeout)
	if err != nil {
		t.Fatal(err)
	}
	if !utf8.ValidString(out) {
		t.Fatal("truncated prompt is not valid utf-8")
	}
	if !strings.Contains(out, "内容已截断，原文约 30000 字，仅保留前 80 KiB") {
		t.Fatalf("got %s", out[len(out)-200:])
	}
	if strings.Count(out, "中") >= 30000 {
		t.Fatal("full document was inlined")
	}
}

func TestBuildUserContentTextAndImageSkipParser(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Errorf("parser should not be called")
	}))
	defer srv.Close()
	t.Setenv("DOC_PARSE_URL", srv.URL)
	timeout := useDocParseClient(t, 2*time.Second)

	root := t.TempDir()
	t.Setenv("OPENBOT_UPLOAD_ROOT", root)
	uid, conv := "user1", "conv1"
	write := func(id, name, mime string, body []byte) AttachmentRef {
		t.Helper()
		relDir := filepath.Join(uid, conv)
		if err := os.MkdirAll(filepath.Join(root, relDir), 0o755); err != nil {
			t.Fatal(err)
		}
		stored := id + "_" + name
		if err := os.WriteFile(filepath.Join(root, relDir, stored), body, 0o644); err != nil {
			t.Fatal(err)
		}
		return AttachmentRef{
			ID: id, Name: name, Mime: mime, Size: int64(len(body)),
			Path: filepath.ToSlash(filepath.Join(relDir, stored)),
		}
	}
	refs := []AttachmentRef{
		write("11111111-1111-1111-1111-111111111111", "a.txt", "text/plain", []byte("hello text")),
		write("22222222-2222-2222-2222-222222222222", "a.png", "image/png", []byte("png")),
	}
	out, extracts, err := buildUserContentWithAttachments(context.Background(), "", uid, conv, refs, timeout)
	if err != nil {
		t.Fatal(err)
	}
	if len(extracts) != 1 || extracts[0].ID != refs[0].ID || !strings.Contains(extracts[0].Markdown, "hello text") {
		t.Fatalf("extracts %+v", extracts)
	}
	if !strings.Contains(out, "hello text") {
		t.Fatalf("text not inlined: %s", out)
	}
	if !strings.Contains(out, "一期未传视觉多模态") {
		t.Fatalf("image note missing: %s", out)
	}
}

func TestResolveDocParseTimeout(t *testing.T) {
	t.Setenv("DOC_PARSE_TIMEOUT_SECONDS", "")
	if got := resolveDocParseTimeout(nil); got != 60*time.Second {
		t.Fatalf("default %s", got)
	}
	n := 120
	if got := resolveDocParseTimeout(&n); got != 120*time.Second {
		t.Fatalf("override %s", got)
	}
	low := 1
	if got := resolveDocParseTimeout(&low); got != 5*time.Second {
		t.Fatalf("clamp low %s", got)
	}
	high := 999
	if got := resolveDocParseTimeout(&high); got != 300*time.Second {
		t.Fatalf("clamp high %s", got)
	}
	t.Setenv("DOC_PARSE_TIMEOUT_SECONDS", "90")
	if got := resolveDocParseTimeout(nil); got != 90*time.Second {
		t.Fatalf("env %s", got)
	}
}

func TestBuildUserContentXlsConverted(t *testing.T) {
	var gotName string
	var gotTimeout string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseMultipartForm(1 << 20); err != nil {
			t.Errorf("multipart: %v", err)
			return
		}
		f, hdr, err := r.FormFile("file")
		if err != nil {
			t.Errorf("file: %v", err)
			return
		}
		defer f.Close()
		gotName = hdr.Filename
		gotTimeout = r.FormValue("timeout_seconds")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"markdown":"| A | B |\n| HelloXLS | 1 |","filename":"legacy.xls","char_count":20,"truncated":false}`))
	}))
	defer srv.Close()
	t.Setenv("DOC_PARSE_URL", srv.URL)
	timeout := useDocParseClient(t, 2*time.Second)

	uid, conv, ref := putUpload(t, "legacy.xls", "application/vnd.ms-excel", []byte("fake-xls"))
	out, _, err := buildUserContentWithAttachments(context.Background(), "总结表格", uid, conv, []AttachmentRef{ref}, timeout)
	if err != nil {
		t.Fatal(err)
	}
	if gotName != "legacy.xls" {
		t.Fatalf("filename %q", gotName)
	}
	if gotTimeout != "2" {
		t.Fatalf("timeout_seconds %q", gotTimeout)
	}
	if !strings.Contains(out, "HelloXLS") || !strings.Contains(out, "以下为用户文件正文") {
		t.Fatalf("got %s", out)
	}
}

func TestOverlayLastUserContent(t *testing.T) {
	h := []runtimeMsg{
		{Role: "user", Content: "你好"},
		{Role: "assistant", Content: "嗯"},
		{Role: "user", Content: "请总结"},
	}
	overlay := "请总结\n\n（用户上传了 1 个附件）\n以下为用户文件正文"
	got := overlayLastUserContent(h, overlay)
	if got[2].Content != overlay {
		t.Fatalf("last user not overlaid: %q", got[2].Content)
	}
	if h[2].Content != "请总结" {
		t.Fatal("original history mutated")
	}
	if got[0].Content != "你好" {
		t.Fatal("earlier turns changed")
	}
}
