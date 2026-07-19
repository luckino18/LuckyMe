#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>
#import <Vision/Vision.h>

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc != 2) {
      fprintf(stderr, "usage: skr-ocr <image>\n");
      return 2;
    }

    NSString *path = [NSString stringWithUTF8String:argv[1]];
    NSImage *image = [[NSImage alloc] initWithContentsOfFile:path];
    NSRect proposed = NSMakeRect(0, 0, image.size.width, image.size.height);
    CGImageRef cgImage = [image CGImageForProposedRect:&proposed context:nil hints:nil];
    if (cgImage == NULL) {
      fprintf(stderr, "unable to read screenshot\n");
      return 3;
    }

    VNRecognizeTextRequest *request = [[VNRecognizeTextRequest alloc] init];
    request.recognitionLevel = VNRequestTextRecognitionLevelAccurate;
    request.usesLanguageCorrection = NO;
    request.minimumTextHeight = 0.012;

    VNImageRequestHandler *handler = [[VNImageRequestHandler alloc] initWithCGImage:cgImage options:@{}];
    NSError *error = nil;
    if (![handler performRequests:@[ request ] error:&error]) {
      fprintf(stderr, "ocr failed: %s\n", error.localizedDescription.UTF8String);
      return 4;
    }

    NSInteger observationIndex = 0;
    for (VNRecognizedTextObservation *observation in request.results) {
      for (VNRecognizedText *candidate in [observation topCandidates:5]) {
        if (candidate != nil) printf("%ld\t%.6f\t%s\n", (long)observationIndex, candidate.confidence, candidate.string.UTF8String);
      }
      observationIndex += 1;
    }
  }
  return 0;
}
