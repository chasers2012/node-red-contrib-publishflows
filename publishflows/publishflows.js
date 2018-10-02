module.exports = function(RED) {
/*
   * Furnish Publish tab with current subflows, files, tabs, and their associated
   * settings from the manifest.js file.
   */

  // Requires
  var glob = require("glob");
  var S = require("string");
  var fs = require("fs");

  // Init vars
  var projectFolder = "";
  var projectName = "";
  
  RED.events.on("runtime-event", function(e) {
    if ("runtime-deploy" != e.id) return;
    // var projects = require(RED.settings.coreNodesDir + "/../red/runtime/storage/index.js").projects;
    // var ap = projects.getActiveProject();
    // ap.package["node-red"].nodes = { "test2": "manifest.js"};
    // projects.updateProject(null, ap.name, {}).then(function() {
    //   console.log("project updated");
    // }).catch(function(err){
    //   console.log("Error in publishflows. " + err.message);
    // });
    // console.log("hello");
  });

  // Furnish publishflows info to publish panel
  RED.httpAdmin.get("/publishflows", RED.auth.needsPermission("publishflows.read"), function(req, res) {
    if (req.query.hasOwnProperty("project")) {
      projectName = req.query.project;
      projectFolder = RED.settings.userDir + "/projects/" + projectName;
      if (fs.existsSync(projectFolder)) {
        readManifestJS().then(function(publish) {
          res.json(publish);
        });
      }else{
        res.status(404).end();
      }
    }else{
	    res.status(404).end();
    }
  });

  function readManifestJS() {
    return new Promise(function(resolve, reject) {
      if (fs.existsSync(projectFolder + "/manifest.js")) {
        var sCode = S(fs.readFileSync(projectFolder + "/manifest.js", 'utf8'));
        sCode = sCode.delLeftMost("RED.publishflows.manifests.push(\n");
        sCode = sCode.delRightMost(");\n").toString();
        var sav = JSON.parse(sCode);

        // Merge default with saved; purge obsolete, irrelevant saved items
        getDefaultManifest().then(function(man) {
          var tp = ["subflows", "files", "tabs"];
          tp.forEach(function(t) {
            for (var m in man[t]){
              var mn = man[t][m];
              for (var s in sav[t]) {
                var sv = sav[t][s];
                if (mn.id == sv.id) {
                  mn.checked = sv.checked;
                }
              }
            }
          });
          resolve(man);
        });
      } else {
        getDefaultManifest().then(function(man) {
          resolve(man);
        });
      }
    });
  }  

  function getDefaultManifest() {
    // Get current subflows, tabs, and files
    var man = {
      subflows: [],
      files: [],
      tabs: [],
      project: projectName
    }
    RED.nodes.eachNode(function(n) {
      if (n.type == "subflow") {
        man.subflows.push({
          name: n.name,
          id: n.id,
          checked: ""
        });
      }
      if (n.type == "tab") {
        man.tabs.push({
          label: n.label,
          id: n.id,
          checked: ""
        });
      }
    });

    // Get current folderitems from filesystem    
    return new Promise(function(resolve, reject) {
      glob(projectFolder + '/**/*', function(err, files) {
        if (err) {
          console.log('Error', err);
        } else {
          // Omit credentials and flow files from listing
          var oFiles = [];
          var aOmit = [];
          var package = JSON.parse(fs.readFileSync(projectFolder + "/package.json"));
          aOmit.push(projectFolder.toLowerCase() + "/" + package["node-red"].settings.credentialsFile);
          aOmit.push(projectFolder.toLowerCase() + "/" + package["node-red"].settings.flowFile);

          // Omit package, manifest, readme.md, .git files/folders
          aOmit.push(projectFolder.toLowerCase() + "/package.json");
          aOmit.push(projectFolder.toLowerCase() + "/manifest.html");
          aOmit.push(projectFolder.toLowerCase() + "/manifest.js");
          aOmit.push(projectFolder.toLowerCase() + "/readme.md");
          aOmit.push(projectFolder.toLowerCase() + "/.gitignore");
          aOmit.push(projectFolder.toLowerCase() + "/.git");
          files.forEach(function(f) {
            f = S(f);
            var o = {
              isDirectory: false,
              name: f.getRightMost("/").toString(),
              path: f.toString(),
              id: f.delLeftMost("projects").delLeftMost(projectName).replaceAll("/", "-").replaceAll(".", "-").slugify().toString(),
              checked: ""
            };
            if (fs.lstatSync(o.path).isDirectory()) {
              o.isDirectory = true;
            }
            // Omit .backup files too
            if (aOmit.indexOf(o.path.toLowerCase()) == -1) {
              if (false == o.path.endsWith(".backup")) {

                // Mask user directory path
                o.path = S(o.path).replaceAll(RED.settings.userDir, '~').toString();
                oFiles.push(o);
              }
            }
          });
          man.files = oFiles;
          resolve(man);
        }
      });
    });
  }

  RED.httpAdmin.post("/publishflows", RED.auth.needsPermission("publishflows.write"), function(req, res) {
    if (req.query.hasOwnProperty("project")) {
      projectName = req.query.project;
      projectFolder = RED.settings.userDir + "/projects/" + projectName;
      if (fs.existsSync(projectFolder)) {
        writeManifestJS(JSON.parse(JSON.stringify(req.body)));
        res.send("{}");
      }else{
        res.status(404).end();
      }
    }else{
	    res.status(404).end();
    }
  });

  function writeManifestJS(man) {
    if (man == "") return;
    var projects = require(RED.settings.coreNodesDir + "/../red/runtime/storage/index.js").projects;
    var ap = projects.getActiveProject();
    var dep = { "dependencies" : JSON.parse(JSON.stringify(ap.package['dependencies']))};

    // Cleanup unnecessary manifest files and package.js if nothing is published
    if (JSON.stringify(man).indexOf('"checked":"checked"') == -1) {
      if (fs.existsSync(projectFolder + "/manifest.js")) {
        fs.unlinkSync(projectFolder + "/manifest.js");
      }
      if (fs.existsSync(projectFolder + "/manifest.html")) {
        fs.unlinkSync(projectFolder + "/manifest.html");
      }
      if (typeof ap.package["node-red"]["nodes"] != "undefined") {
        if (typeof ap.package["node-red"]["nodes"][ap.name] != "undefined") {
          delete ap.package["node-red"]["nodes"][ap.name];
        }
        if (JSON.stringify(ap.package["node-red"]["nodes"]) == "{}") {
          delete ap.package["node-red"]["nodes"];
        }
      }

      // Force package.js save & update
      projects.updateProject(null, ap.name, {"dependencies":{}});
      projects.updateProject(null, ap.name, dep);
      return;
    }

    // Write manifest files
    var sCode = "";
    sCode += "/**\n";
    sCode += " * This code is machine generated.\n";
    sCode += " */\n";
    sCode += "module.exports = function(RED) {\n";
    sCode += "  if (typeof RED.publishflows != 'undefined') {\n";
    sCode += "    RED.publishflows.manifests.push(\n";
    sCode += S(JSON.stringify(man, null, 2)).replaceAll("\n", "\n      ").prepend("      ").toString();
    sCode += "\n    );\n";
    sCode += "  }\n";
    sCode += "};\n";
    fs.writeFileSync(projectFolder + "/manifest.js", sCode);
    fs.writeFileSync(projectFolder + "/manifest.html", "<!-- silence is golden -->");

    // Update package.js
    if (typeof ap.package["node-red"]["nodes"] == "undefined") {
      ap.package["node-red"]["nodes"] = {};
    }
    ap.package["node-red"]["nodes"][ap.name] = "manifest.js";
    projects.updateProject(null, ap.name, {"dependencies":{}});
    projects.updateProject(null, ap.name, dep);
  }

  // JavaScript version of var_dump
  function var_dump(arr, level) {
      var dumped_text = "";
      if (!level)
          level = 0;

      //The padding given at the beginning of the line.
      var level_padding = "";
      for (var j = 0; j < level + 1; j++)
          level_padding += "    ";

      if (typeof(arr) === 'object') { //Array/Hashes/Objects 
          for (var item in arr) {
              var value = arr[item];

              if (typeof(value) === 'object') { //If it is an array,
                  dumped_text += level_padding + "'" + item + "' ...\n";
                  dumped_text += var_dump(value, level + 1);
              } else {
                  dumped_text += level_padding + "'" + item + "' => " + "(" + typeof(value) + ") \"" + value + "\"\n";
              }
          }
      } else { //Stings/Chars/Numbers etc.
          dumped_text = "(" + typeof(arr) + ") " + arr;
          return dumped_text;
      }
      if (level===0){
          return '(object)' + String.fromCharCode(10) + dumped_text;
      }else{
          return dumped_text;
      }
  }
}
