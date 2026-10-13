using System.Text.Json;

var root = Environment.GetEnvironmentVariable("SMOREC_NATIVE_UPDATE_FIXTURE");
if (root == null || !Path.GetFullPath(root).Contains(Path.Combine("output", "staged-updates"))) return 30;
if (File.Exists(Path.Combine(AppContext.BaseDirectory, "resources", "fail.txt"))) return 27;
var version = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "resources", "version.txt"));
File.AppendAllText(Path.Combine(root, "boots.jsonl"), JsonSerializer.Serialize(new { version, args }) + "\n");
return 0;
