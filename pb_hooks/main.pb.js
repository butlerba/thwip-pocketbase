/// <reference path="../pb_data/types.d.ts" />

routerAdd("GET", "/hello/:name", (c) => {
  let name = c.pathParam("name");

  return c.json(200, { message: "Hello " + name });
});

routerAdd("GET", "/list-comics", async (c) => {
  const getAllFiles = function (path, arrayOfFiles) {
    const files = $os.readDir(`${path}`);
    //console.log("got first files");
    arrayOfFiles = arrayOfFiles || [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      // console.log("name", file.name());
      // console.log("type", file.type());
      // console.log("file", file);
      if (
        file.name() != "." &&
        file.name() != ".." &&
        file.name().indexOf(".") != 0
      ) {
        if (file.isDir()) {
          //    console.log("got a directory");
          arrayOfFiles = getAllFiles(path + "/" + file.name(), arrayOfFiles);
        } else {
          if (
            file.name().indexOf(".cbr") > 0 ||
            file.name().indexOf(".cbz") > 0
          ) {
            arrayOfFiles.push(path + "/" + file.name());
          }
        }
      }
    }

    return arrayOfFiles;
  };

  const parseFileName = function (fileName) {
    let name = fileName.replace("_", " ").replace(".", " ");
    console.log("name: " + name);
    let data = {
      seriesName: name, // fall back
      issueNumber: 0, // fall back
      year: 1999, // fall back
    };

    let parts = name.split("(");
    console.log("parts: " + parts.join("/r/n"));
    if (parts.length > 1) {
      let possibleyear = parts[1].split(")")?.[0];
      console.log("possibleyear: " + possibleyear);
      if (
        possibleyear &&
        +possibleyear.replace("(", "").replace(")", "") &&
        possibleyear.replace("(", "").replace(")", "").length == 4
      ) {
        data.year = possibleyear.replace("(", "").replace(")", "");
      }
    }

    let nameandissueparts = parts[0].split(" ");
    console.log("nameandissueparts:" + nameandissueparts.join("/r/n"));
    let issuepart = nameandissueparts.length - 2;
    console.log("issuepart: " + issuepart);
    data.issueNumber = nameandissueparts[issuepart];
    if (data.issueNumber.toString().length < 3) {
      const zeros = 3 - data.issueNumber.toString().length;
      newissue = "";
      for (let i = 0; i < zeros; i++) {
        newissue += "0";
      }
      data.issueNumber = newissue + data.issueNumber;
    }

    var seriesname = "";
    nameandissueparts
      .slice(0, issuepart)
      .map((p) => (seriesname = seriesname + p + " "));
    seriesname = seriesname.trimEnd();
    console.log("seriesname: " + seriesname);
    data.seriesName = seriesname;

    console.log(
      `series name = ${data.seriesName}   -   issue num = ${data.issueNumber}   -   year = ${data.year}`
    );

    return data;
  };

  const extractFiles = async function (filePath, destination) {
    console.log("extracting files");
    $os.mkdirAll(destination, 0o777);
    console.log("made dir");
    if (filePath.indexOf(".cbr") > 0) {
      console.log("file is rar");
      // extract the files from the cbr
      try {
        const unrar = $os.exec("unrar", "x", "-ierr", filePath, destination);
        const log = String.fromCharCode(...unrar.output());
        console.log("unrar res: " + log);
      } catch (e) {
        console.log("error unraring: " + e);
      }
    } else if (filePath.indexOf(".cbz") > 0) {
      console.log("file is zip");
      try {
        // extract the files from the cbz
        const unzip = $os.exec("unzip", filePath, "-d", destination);
        const log = String.fromCharCode(...unzip.output());
        console.log("unzip res: " + log);
      } catch (e) {
        console.log("error unzipping: " + e);
      }
    }
    // get the files in the tmp folder
    let files = $os.readDir(destination);
    files = files.filter((f) => f.name() !== "__MACOSX"); // filter out the macosx folder if it exists
    if (files.length === 1) {
      // if there is only one file, assume it's a folder and get the files in that folder
      console.log("looks like a subfolder");
      const subfolder = files[0];
      files = $os.readDir(destination + "/" + subfolder.name());
      console.log("files: " + files);
      return files.map(
        (f) => destination + "/" + subfolder.name() + "/" + f.name()
      );
    } else {
      console.log("files: " + files);
      return files.map((f) => destination + "/" + f.name());
    }
  };

  const padPageNumber = function (pageNumber) {
    if (pageNumber.toString().length < 3) {
      const zeros = 3 - pageNumber.toString().length;
      let newPageNumber = "";
      for (let i = 0; i < zeros; i++) {
        newPageNumber += "0";
      }
      return newPageNumber + pageNumber;
    }
    return pageNumber;
  };

  const convertToWebp = async function (pageFiles) {
    for (let j = 0; j < pageFiles.length; j++) {
      let fullFile = pageFiles[j];
      // for each file, upload the file to storage
      // webp file needs to be converted to jpg
      console.log("Converting webp to jpg");
      const ext = pageFiles[j].split(".").pop();
      let destFileName = `/comics/temp/${padPageNumber(j)}.webp`;
      try {
        const convert = $os.exec(
          "cwebp",
          "-q",
          "60",
          fullFile,
          "-o",
          destFileName
        );
        convert.run();
      } catch (e) {
        console.log("error converting to webp: " + e);
      }
      // check if the file exists
      const readFile = $os.readFile(destFileName);
      console.log("File exists " + (readFile.length > 0 ? "true" : "false"));

      if (j === 0) {
        // create the cover image
        const destCoverFileName = `/comics/temp/cover.webp`;
        try {
          const convertCover = $os.exec(
            "cwebp",
            "-q",
            "60",
            "-resize",
            "400",
            "600",
            fullFile,
            "-o",
            destCoverFileName
          );
          convertCover.run();
        } catch (e) {
          console.log("error converting cover to webp: " + e);
        }
        // check if the file exists
        const readCoverFile = $os.readFile(destCoverFileName);
        console.log(
          "File exists: " + (readCoverFile.length > 0 ? "true" : "false")
        );

        // upload the cover file to the comic object
      }

      let file;
      if (readFile.length > 0) {
        // upload the file
        // delete the original file
        $os.remove(fullFile);
      } else {
        // upload the original file renamed to j.ext
      }
    }
  };

  const moveFileToComplete = function (filePath) {
    try {
      // get folder name the file is in
      const folderparts = filePath.split("/");
      console.log("folder: " + folderparts[3]);

      // create the folder in the processed folder
      $os.mkdirAll("/comics/processed/" + folderparts[3], 0o777);

      const move = $os.exec(
        "mv",
        filePath,
        filePath.replace("/comics/new", "/comics/processed")
      );
      move.run();
    } catch (e) {
      console.log("error moving file: " + e);
    }
  };

  const cleanUpTempFiles = function () {
    try {
      // remove all the files in the temp folder, but leave the folder
      const files = $os.readDir("/comics/temp");
      for (let i = 0; i < files.length; i++) {
        $os.remove("/comics/temp/" + files[i].name());
      }
    } catch (e) {
      console.log("error cleaning up temp files: " + e);
    }
  };

  const checkIfFileExistsInSystem = function (filePath) {
    // get the file name from the file path
    const fileParts = filePath.split("/");
    const fileName = fileParts[fileParts.length - 1];

    // check if the file exists in the db comics table by the file name
    // if it does, return true
    try {
      const record = $app
        .dao()
        .findFirstRecordByFilter("comics", "fileName = {:fileName}", {
          fileName: fileName,
        });

      return record ? true : false;
    } catch (e) {
      console.log("error checking if file exists: " + e);
      return false;
    }
  };

  const convertIssueNumberToNumber = function (issueNumber) {
    // remove any non-numeric characters and leading zeros
    const numbersOnly = issueNumber.replace(/[^0-9]/g, "");
    console.log("issue number: " + numbersOnly);
    return +numbersOnly;
  };

  const createComicRecord = function (comicData, fileName) {
    const collection = $app.dao().findCollectionByNameOrId("comics");

    const record = new Record(collection, {
      // bulk load the record data during initialization
      id: fileName.replaceAll(" ", "_").replaceAll(".cbr", "").replaceAll(".cbz", "").toLowerCase(),
      fileName: fileName,
      matched: false,
      name: `${comicData.seriesName} #${comicData.issueNumber}`,
      issueNumber: comicData.issueNumber,
      sortIssueNumber: convertIssueNumberToNumber(comicData.issueNumber),
    });

    $app.dao().saveRecord(record);

    // get the record
    const comicRecord = $app
      .dao()
      .findFirstRecordByFilter("comics", "fileName = {:fileName}", {
        fileName: fileName,
      });

    return comicRecord;
  };

  const createCoverImage = function (comicRecord, coverImage) {
    try {
      // manually upload the cover image to the comic record
      const cover = $filesystem.fileFromPath(coverImage);
      console.log("cover: " + cover);

      const form = new RecordUpsertForm($app, comicRecord);

      // manually upload file(s)
      form.addFiles("cover", cover);

      // validate and submit (internally it calls $app.dao().saveRecord(record) in a transaction)
      form.submit();

      return comicRecord;
    } catch (e) {
      console.log("error creating cover image: " + e);
    }
  };

  const getAllConvertedFiles = function () {
    const files = $os.readDir("/comics/temp");
    return files
      .filter((f) => f.isDir() == false && f.name() !== "cover.webp")
      .map((f) => "/comics/temp/" + f.name());
  };

  const createComicPages = function (comicRecord, pageImages) {
    const pages = [];
    for (let i = 0; i < pageImages.length; i++) {
      const page = $filesystem.fileFromPath(pageImages[i]);

      pages.push(page);
    }

    // set up the form
    const form = new RecordUpsertForm($app, comicRecord);

    // manually upload file(s)
    form.addFiles("pages", ...pages);

    form.submit();

    return comicRecord;
  };

  try {
    const allFiles = getAllFiles("/comics/new");

    // take the first 5 files and process them
    const filesToProcess = allFiles.slice(0, 5);

    for (let i = 0; i < filesToProcess.length; i++) {
      if (!checkIfFileExistsInSystem(filesToProcess[i])) {
        // if the file doesn't exist in the system, process it
        // get the file name
        const file = filesToProcess[i];
        const fileParts = file.split("/");
        // get the comic data
        const parsedFileName = parseFileName(fileParts[fileParts.length - 1]);
        console.log("parsedFileName: " + parsedFileName);
        console.log("created comic record");
        // create the comic record
        let comicRecord = createComicRecord(
          parsedFileName,
          fileParts[fileParts.length - 1]
        );

        console.log("comic record", comicRecord);

        const extractedFiles = await extractFiles(
          filesToProcess[i],
          "/comics/temp"
        );

        const pageFiles = extractedFiles.filter(
          (f) =>
            f.indexOf(".jpg") > -1 ||
            f.indexOf(".png") > -1 ||
            f.indexOf(".jpeg") > -1 ||
            f.indexOf(".gif") > -1 ||
            f.indexOf(".bmp") > -1 ||
            f.indexOf(".webp") > -1
        );

        await convertToWebp(pageFiles);
        console.log("converted");
        // update the comic record with the cover image
        comicRecord = createCoverImage(comicRecord, "/comics/temp/cover.webp");
        console.log("cover created");
        // get all the non-cover images
        const allConvertedFiles = getAllConvertedFiles();
        console.log("allConvertedFiles: " + allConvertedFiles);
        comicRecord = createComicPages(comicRecord, allConvertedFiles);

        moveFileToComplete(filesToProcess[i]);

        cleanUpTempFiles();
      } else {
        // just move it to the processed folder
        moveFileToComplete(filesToProcess[i]);
      }
    }

    //  console.log(allFiles);
    return c.json(200, { filesProcessed: filesToProcess });
  } catch (e) {
    console.log(e);
    return c.json(500, { message: "Error", error: e });
  }
});
