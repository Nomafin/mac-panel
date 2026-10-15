// Reads the QR codes in an image with macOS's Vision framework and prints them as a JSON array.
// The image is the clipboard's, or a file given as the first argument. Run by authenticator_ui.lua:
//   osascript -l JavaScript qr_decode.js [image-file]
// Prints {"error": "no_image"} when there's no image to read.
ObjC.import('AppKit');
ObjC.import('Vision');

function run(argv) {
  const image = argv.length
    ? $.NSImage.alloc.initWithContentsOfFile(argv[0])
    : $.NSImage.alloc.initWithPasteboard($.NSPasteboard.generalPasteboard);
  if (!image || image.isNil()) return JSON.stringify({ error: 'no_image' });
  const cg = image.CGImageForProposedRectContextHints(null, $(), $());
  if (!cg) return JSON.stringify({ error: 'no_image' });

  const request = $.VNDetectBarcodesRequest.alloc.init;
  request.symbologies = $([$.VNBarcodeSymbologyQR]);
  const handler = $.VNImageRequestHandler.alloc.initWithCGImageOptions(cg, $({}));
  handler.performRequestsError($([request]), null);

  const codes = [];
  const results = request.results;
  for (let i = 0; i < results.count; i++) {
    const text = results.objectAtIndex(i).payloadStringValue.js;
    if (text && !codes.includes(text)) codes.push(text);
  }
  return JSON.stringify(codes);
}
