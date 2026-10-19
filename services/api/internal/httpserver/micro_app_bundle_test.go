package httpserver

import (
	"archive/zip"
	"bytes"
	"testing"
)

func TestUnpackMicroAppZipFlatten(t *testing.T) {
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	w, err := zw.Create("demo/index.html")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = w.Write([]byte("<html><body>hi</body></html>"))
	w2, err := zw.Create("demo/manifest.json")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = w2.Write([]byte(`{"entry":"index.html","capabilities":["ui.notify"]}`))
	_ = zw.Close()

	files, entry, err := unpackMicroAppZip(buf.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	if entry != "index.html" {
		t.Fatalf("entry %q", entry)
	}
	if _, ok := files["index.html"]; !ok {
		t.Fatalf("keys %#v", files)
	}
	if err := validateManifestCapabilities(files["manifest.json"], []string{"ui.notify", "cloud.http"}); err != nil {
		t.Fatal(err)
	}
	if err := validateManifestCapabilities(files["manifest.json"], []string{"cloud.http"}); err == nil {
		t.Fatal("expected undeclared capability error")
	}
}
