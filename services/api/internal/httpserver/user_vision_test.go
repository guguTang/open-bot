package httpserver

import (
	"bytes"
	"context"
	"image"
	"image/png"
	"math/rand"
	"strings"
	"testing"

	"github.com/tangxin/open-bot/services/api/internal/db"
)

func tinyPNG(t *testing.T) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 8, 8))
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestPrepareUserVisionPassthroughAndReject(t *testing.T) {
	pngBytes := tinyPNG(t)
	_, _, ref := putUpload(t, "dot.png", "image/png", pngBytes)
	abs, err := resolveAttachmentPath("user1", "conv1", ref)
	if err != nil {
		t.Fatal(err)
	}
	part, note := prepareUserVisionFile(abs, "image/png", "dot.png")
	if part == nil || part.MIME != "image/png" || note != imageNoteAttached {
		t.Fatalf("part=%+v note=%s", part, note)
	}
	if strings.Contains(note, part.Data) {
		t.Fatal("note contains pixels")
	}

	_, gifNote := prepareUserVisionFile(abs, "image/gif", "dot.gif")
	if gifNote != imageNoteBadMIME {
		t.Fatalf("gif %s", gifNote)
	}
}

func TestPrepareUserVisionCompressesOverCap(t *testing.T) {
	img := image.NewRGBA(image.Rect(0, 0, 480, 360))
	_, _ = rand.New(rand.NewSource(1)).Read(img.Pix)
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	jpg, err := encodeVisionJPEG(img, 60)
	if err != nil {
		t.Fatal(err)
	}
	if len(jpg) >= buf.Len() {
		t.Fatalf("jpeg %d not smaller than png %d", len(jpg), buf.Len())
	}
	prev := userVisionMaxBytes
	userVisionMaxBytes = len(jpg) + 32
	t.Cleanup(func() { userVisionMaxBytes = prev })
	if buf.Len() <= userVisionMaxBytes {
		t.Fatalf("png %d should exceed cap %d", buf.Len(), userVisionMaxBytes)
	}
	_, _, ref := putUpload(t, "big.png", "image/png", buf.Bytes())
	abs, err := resolveAttachmentPath("user1", "conv1", ref)
	if err != nil {
		t.Fatal(err)
	}
	part, note := prepareUserVisionFile(abs, "image/png", "big.png")
	if part == nil || part.MIME != "image/jpeg" || note != imageNoteAttached {
		t.Fatalf("part=%v note=%s png=%d cap=%d", part, note, buf.Len(), userVisionMaxBytes)
	}
}

func TestBuildUserContentVisionOmitsPixels(t *testing.T) {
	pngBytes := tinyPNG(t)
	uid, conv, ref := putUpload(t, "dot.png", "image/png", pngBytes)
	out, _, err := buildUserContentWithAttachments(context.Background(), "图里有什么", uid, conv, []AttachmentRef{ref}, 0, true)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, imageNoteAttached) || !strings.Contains(out, "图里有什么") {
		t.Fatal(out)
	}
	if strings.Contains(out, "base64,") {
		t.Fatal("pixels inlined into model text")
	}
}

func TestHistoryForModelVisionOnAndOff(t *testing.T) {
	pngBytes := tinyPNG(t)
	uid, conv, ref := putUpload(t, "shot.png", "image/png", pngBytes)
	msg := db.Message{
		ID:             "m1",
		Role:           "user",
		Content:        "图里有什么",
		ConversationID: conv,
		Attachments: []db.MessageAttachment{{
			ID:             ref.ID,
			ConversationID: conv,
			UserID:         uid,
			Name:           ref.Name,
			Mime:           ref.Mime,
			Size:           ref.Size,
			Path:           ref.Path,
		}},
	}
	on := historyForModel([]db.Message{msg}, "", "", nil, true)
	if len(on) != 1 || len(on[0].UserImages) != 1 {
		t.Fatalf("on %+v", on)
	}
	if strings.Contains(on[0].Content, on[0].UserImages[0].Data) {
		t.Fatal("base64 leaked into history text")
	}
	if !strings.Contains(on[0].Content, imageNoteAttached) || !strings.Contains(on[0].Content, "图里有什么") {
		t.Fatal(on[0].Content)
	}

	off := historyForModel([]db.Message{msg}, "", "", nil, false)
	if len(off[0].UserImages) != 0 {
		t.Fatal("text model received pixels")
	}
	if !strings.Contains(off[0].Content, imageNoteNoVision) {
		t.Fatal(off[0].Content)
	}
}

func TestTrimUserVisionKeepsNewest(t *testing.T) {
	old := runtimeMsg{Role: "user", Content: "旧 " + imageNoteAttached, UserImages: []userVisionPart{{MIME: "image/png", Data: "aaaa"}}}
	newer := runtimeMsg{Role: "user", Content: "新 " + imageNoteAttached, UserImages: []userVisionPart{{MIME: "image/png", Data: "bbbb"}}}
	out := trimUserVisionImages([]runtimeMsg{old, newer}, 1)
	if len(out[0].UserImages) != 0 || !strings.Contains(out[0].Content, imageNoteOlderBudget) {
		t.Fatalf("old %+v", out[0])
	}
	if len(out[1].UserImages) != 1 || out[1].UserImages[0].Data != "bbbb" {
		t.Fatalf("new %+v", out[1])
	}
}
