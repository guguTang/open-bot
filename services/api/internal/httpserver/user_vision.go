package httpserver

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"image"
	"image/jpeg"
	_ "image/png"
	"os"
	"path/filepath"
	"strings"

	"github.com/tangxin/open-bot/services/api/internal/db"
)

// Pixel budget matches the desktop screenshot cap (SCREENSHOT_MAX_BYTES)
// and host_vision._MAX_B64_CHARS. jpeg/png/webp only, same as host screenshots.
var userVisionMaxBytes = 1_200_000

const (
	userVisionMaxB64              = 2_000_000
	maxUserVisionImagesPerMessage = 4
	maxUserVisionImagesTotal      = 6
	imageNoteNoVision             = "图片已存储；当前模型不支持看图，仅文件名/类型提及"
	imageNoteAttached             = "图片已随消息交给模型，请直接看图"
	imageNoteTooBig               = "图片过大，压缩后仍无法交给模型，仅文件名/类型提及"
	imageNoteBadMIME              = "图片已存储；看图仅支持 jpeg/png/webp，此文件仅文件名/类型提及"
	imageNoteUnreadable           = "图片已存储；无法读取或解码，没有把图像交给模型"
	imageNoteBudget               = "同条消息附图过多，其余仅文件名/类型提及"
	imageNoteOlderBudget          = "更早的图片未再次附上，仅文件名/类型提及"
	imageNoteSteer                = "图片已存储；这次是插入进行中的回复，未附上像素，不要假装看过图"
)

// userVisionPart is an OpenAI-compatible image carried beside message text.
// It is not written into the messages table.
type userVisionPart struct {
	MIME string `json:"mime"`
	Data string `json:"data"`
}

func isImageMIME(mimeType string) bool {
	m := strings.ToLower(strings.TrimSpace(mimeType))
	if i := strings.Index(m, ";"); i >= 0 {
		m = strings.TrimSpace(m[:i])
	}
	return strings.HasPrefix(m, "image/")
}

func canonicalImageMIME(mimeType, name string) string {
	m := strings.ToLower(strings.TrimSpace(mimeType))
	if i := strings.Index(m, ";"); i >= 0 {
		m = strings.TrimSpace(m[:i])
	}
	switch m {
	case "image/jpg", "image/pjpeg":
		return "image/jpeg"
	case "image/jpeg", "image/png", "image/webp", "image/gif":
		return m
	}
	switch strings.ToLower(filepath.Ext(name)) {
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".png":
		return "image/png"
	case ".webp":
		return "image/webp"
	case ".gif":
		return "image/gif"
	}
	return m
}

func attachmentLooksLikeImage(mimeType, name string) bool {
	if isImageMIME(mimeType) {
		return true
	}
	return strings.HasPrefix(canonicalImageMIME("", name), "image/")
}

func visionMIMEAllowed(mimeType string) bool {
	switch mimeType {
	case "image/jpeg", "image/png", "image/webp":
		return true
	default:
		return false
	}
}

func prepareUserVisionFile(abs, mimeType, name string) (*userVisionPart, string) {
	mimeType = canonicalImageMIME(mimeType, name)
	if !visionMIMEAllowed(mimeType) {
		return nil, imageNoteBadMIME
	}
	raw, err := os.ReadFile(abs)
	if err != nil || len(raw) == 0 {
		return nil, imageNoteUnreadable
	}
	if mimeType == "image/webp" {
		if len(raw) > userVisionMaxBytes || base64.StdEncoding.EncodedLen(len(raw)) > userVisionMaxB64 {
			return nil, imageNoteTooBig
		}
		return &userVisionPart{MIME: "image/webp", Data: base64.StdEncoding.EncodeToString(raw)}, imageNoteAttached
	}
	if len(raw) <= userVisionMaxBytes && base64.StdEncoding.EncodedLen(len(raw)) <= userVisionMaxB64 {
		return &userVisionPart{MIME: mimeType, Data: base64.StdEncoding.EncodeToString(raw)}, imageNoteAttached
	}
	img, _, err := image.Decode(bytes.NewReader(raw))
	if err != nil {
		return nil, imageNoteUnreadable
	}
	ladder := []struct {
		edge    int
		quality int
	}{
		{1600, 60},
		{1280, 45},
		{960, 35},
		{640, 30},
	}
	for _, step := range ladder {
		jpg, err := encodeVisionJPEG(resizeMaxEdge(img, step.edge), step.quality)
		if err != nil {
			return nil, imageNoteUnreadable
		}
		if len(jpg) <= userVisionMaxBytes && base64.StdEncoding.EncodedLen(len(jpg)) <= userVisionMaxB64 {
			return &userVisionPart{MIME: "image/jpeg", Data: base64.StdEncoding.EncodeToString(jpg)}, imageNoteAttached
		}
	}
	return nil, imageNoteTooBig
}

func encodeVisionJPEG(img image.Image, quality int) ([]byte, error) {
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: quality}); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func resizeMaxEdge(src image.Image, maxEdge int) image.Image {
	b := src.Bounds()
	w, h := b.Dx(), b.Dy()
	if w < 1 || h < 1 || maxEdge < 1 {
		return src
	}
	edge := w
	if h > edge {
		edge = h
	}
	if edge <= maxEdge {
		return src
	}
	nw := w * maxEdge / edge
	nh := h * maxEdge / edge
	if nw < 1 {
		nw = 1
	}
	if nh < 1 {
		nh = 1
	}
	dst := image.NewRGBA(image.Rect(0, 0, nw, nh))
	for y := 0; y < nh; y++ {
		sy := b.Min.Y + y*h/nh
		if sy >= b.Max.Y {
			sy = b.Max.Y - 1
		}
		for x := 0; x < nw; x++ {
			sx := b.Min.X + x*w/nw
			if sx >= b.Max.X {
				sx = b.Max.X - 1
			}
			dst.Set(x, y, src.At(sx, sy))
		}
	}
	return dst
}

func userVisionForMessage(content string, atts []db.MessageAttachment, vision bool) (string, []userVisionPart) {
	if len(atts) == 0 {
		return content, nil
	}
	var lines []string
	var parts []userVisionPart
	for _, a := range atts {
		if !attachmentLooksLikeImage(a.Mime, a.Name) {
			continue
		}
		name := strings.TrimSpace(a.Name)
		if name == "" {
			name = "image"
		}
		mimeShow := a.Mime
		if mimeShow == "" {
			mimeShow = canonicalImageMIME("", name)
		}
		if !vision {
			lines = append(lines, fmt.Sprintf("- %s (%s)：%s", name, mimeShow, imageNoteNoVision))
			continue
		}
		if len(parts) >= maxUserVisionImagesPerMessage {
			lines = append(lines, fmt.Sprintf("- %s (%s)：%s", name, mimeShow, imageNoteBudget))
			continue
		}
		abs, err := resolveAttachmentPath(a.UserID, a.ConversationID, AttachmentRef{
			ID: a.ID, Name: a.Name, Mime: a.Mime, Size: a.Size, Path: a.Path,
		})
		if err != nil {
			lines = append(lines, fmt.Sprintf("- %s (%s)：%s", name, mimeShow, imageNoteUnreadable))
			continue
		}
		part, note := prepareUserVisionFile(abs, a.Mime, a.Name)
		lines = append(lines, fmt.Sprintf("- %s (%s)：%s", name, mimeShow, note))
		if part != nil {
			parts = append(parts, *part)
		}
	}
	if len(lines) == 0 {
		return content, nil
	}
	block := "（附件图片）\n" + strings.Join(lines, "\n")
	content = strings.TrimSpace(content)
	if content == "" {
		return block, parts
	}
	return content + "\n\n" + block, parts
}

// trimUserVisionImages keeps the newest images inside the history window.
// Older pixels become an honest text mention.
func trimUserVisionImages(history []runtimeMsg, max int) []runtimeMsg {
	if max < 1 {
		max = 1
	}
	total := 0
	for _, m := range history {
		total += len(m.UserImages)
	}
	extra := total - max
	if extra <= 0 {
		return history
	}
	for i := range history {
		if extra <= 0 {
			break
		}
		n := len(history[i].UserImages)
		if n == 0 {
			continue
		}
		if n <= extra {
			history[i].UserImages = nil
			extra -= n
			history[i].Content = strings.ReplaceAll(history[i].Content, imageNoteAttached, imageNoteOlderBudget)
			continue
		}
		history[i].UserImages = history[i].UserImages[extra:]
		extra = 0
		if !strings.Contains(history[i].Content, imageNoteOlderBudget) {
			history[i].Content += "\n（" + imageNoteOlderBudget + "）"
		}
	}
	return history
}

// steerRuntimeText is the busy-inbox payload. That queue is text-only, so it must
// not claim the model can see pixels that were not attached.
func steerRuntimeText(content string, vision bool) string {
	if !vision || content == "" {
		return content
	}
	return strings.ReplaceAll(content, "（"+imageNoteAttached+"）", "（"+imageNoteSteer+"）")
}
