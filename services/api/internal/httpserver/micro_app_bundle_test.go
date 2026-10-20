package httpserver

import (
	"archive/zip"
	"bytes"
	"encoding/json"
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

func TestPackMicroAppZipRoundTrip(t *testing.T) {
	in := map[string][]byte{
		"index.html":    []byte("<html>ok</html>"),
		"manifest.json": []byte(`{"entrypoint":"index.html","capabilities":["ui.notify"]}`),
		"assets/a.css":  []byte("body{}"),
	}
	zipBytes, err := packMicroAppZip(in)
	if err != nil {
		t.Fatal(err)
	}
	out, entry, err := unpackMicroAppZip(zipBytes)
	if err != nil {
		t.Fatal(err)
	}
	if entry != "index.html" {
		t.Fatalf("entry %q", entry)
	}
	for k, v := range in {
		got, ok := out[k]
		if !ok {
			t.Fatalf("missing %s in %#v", k, out)
		}
		if !bytes.Equal(got, v) {
			t.Fatalf("%s mismatch", k)
		}
	}
}

func TestPackMicroAppZipRejectsTraversal(t *testing.T) {
	_, err := packMicroAppZip(map[string][]byte{"../etc/passwd": []byte("x")})
	if err == nil {
		t.Fatal("expected illegal path")
	}
}

func TestDecodeMicroAppFilesMap(t *testing.T) {
	raw := map[string]json.RawMessage{
		"index.html":    json.RawMessage(`"<h1>hi</h1>"`),
		"manifest.json": json.RawMessage(`{"encoding":"utf8","content":"{\"capabilities\":[]}"}`),
		"bin.dat":       json.RawMessage(`{"encoding":"base64","content":"aGVsbG8="}`),
	}
	files, err := decodeMicroAppFilesMap(raw)
	if err != nil {
		t.Fatal(err)
	}
	if string(files["index.html"]) != "<h1>hi</h1>" {
		t.Fatalf("html %q", files["index.html"])
	}
	if string(files["bin.dat"]) != "hello" {
		t.Fatalf("bin %q", files["bin.dat"])
	}
	_, err = decodeMicroAppFilesMap(map[string]json.RawMessage{"../../x": json.RawMessage(`"a"`)})
	if err == nil {
		t.Fatal("expected traversal reject")
	}
}
