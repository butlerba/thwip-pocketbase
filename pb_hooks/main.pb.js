/// <reference path="../pb_data/types.d.ts" />

routerAdd("GET", "/hello/:name", (c) => {
  let name = c.pathParam("name");

  return c.json(200, { message: "Hello " + name });
});

// enable the cron to run every 15 minutes
cronAdd("comicImport", "*/15 * * * *", async () => {
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
      let newissue = "";
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

  const moveFileToErrored = function (filePath) {
    try {
      // get folder name the file is in
      const folderparts = filePath.split("/");
      console.log("folder: " + folderparts[3]);

      // create the folder in the processed folder
      $os.mkdirAll("/comics/errored/" + folderparts[3], 0o777);

      const move = $os.exec(
        "mv",
        filePath,
        filePath.replace("/comics/new", "/comics/errored")
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
        //$os.remove("/comics/temp/" + files[i].name());
        const rm = $os.exec("rm", "-rf", "/comics/temp/" + files[i].name());
        rm.run();
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
      id: fileName
        .replaceAll(" ", "_")
        .replaceAll(".cbr", "")
        .replaceAll(".cbz", "")
        .toLowerCase(),
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
      .filter(
        (f) =>
          f.isDir() == false &&
          f.name() !== "cover.webp" &&
          f.name().indexOf(".xml") <= -1
      )
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
    const filesToProcess = allFiles.slice(0, 15);

    for (let i = 0; i < filesToProcess.length; i++) {
      try {
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
              (f.indexOf(".jpg") > -1 ||
                f.indexOf(".png") > -1 ||
                f.indexOf(".jpeg") > -1 ||
                f.indexOf(".gif") > -1 ||
                f.indexOf(".bmp") > -1 ||
                f.indexOf(".webp") > -1) &&
              f.indexOf(".xml") == -1
          );

          await convertToWebp(pageFiles);
          console.log("converted");
          // update the comic record with the cover image
          comicRecord = createCoverImage(
            comicRecord,
            "/comics/temp/cover.webp"
          );
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
      } catch (e) {
        console.log("error processing file: " + e);
        try {
          moveFileToErrored(filesToProcess[i]);
          cleanUpTempFiles();
        } catch (e) {
          console.log("error moving file to errored: " + e);
        }
      }
    }

    //  console.log(allFiles);
    console.log("files processed");
    //return c.json(200, { filesProcessed: filesToProcess });
  } catch (e) {
    console.log(e);
    //return c.json(500, { message: "Error", error: e });
  } finally {
    try {
      cleanUpTempFiles();
    } catch (e) {
      console.log("error cleaning up: " + e);
    }
  }
});

routerAdd("GET", "/metron/search-series", async (c) => {
  try {
    console.log("searching");
    const query = c.queryParam("query");
    const year = c.queryParam("year");
    // web encode the query
    const webEncodedQuery = encodeURIComponent(query);

    console.log("query: " + webEncodedQuery);
    console.log("year: " + year);
    const metron = require(`${__hooks}/metron.js`);

    const res = await metron.findSeries(webEncodedQuery, year);

    return c.json(200, { message: "Success", data: res });
  } catch (e) {
    console.log("error: " + e);
    return c.json(500, { message: "Error", error: e });
  }
});

routerAdd("GET", "metron/match-comic", async (c) => {
  const metron = require(`${__hooks}/metron.js`);

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
      let newissue = "";
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

  try {
    // get the first non-matched comic from the db
    const comic = $app
      .dao()
      .findFirstRecordByFilter("comics", "matched = {:matched}", {
        matched: false,
      });

    console.log("comic: " + comic.get("fileName"));

    // parse the file name to get the series name, issue number, and year
    const parsedFileName = parseFileName(comic.get("fileName"));
    console.log(
      "parsedFileName: " +
        parsedFileName.seriesName +
        " - " +
        parsedFileName.issueNumber +
        " - " +
        parsedFileName.year
    );

    // see if there is a either direct series name match in the database, or a series allias match
    // if there is, update the comic record with the series id
    // if there isn't, search metron for the series name and year
    let series;
    try {
      series = $app
        .dao()
        .findFirstRecordByFilter(
          "series",
          "(name = {:name} || alliases.name = {:name}) && startYear <= {:year} && (endYear >= {:year} || endYear = 0)",
          {
            name: parsedFileName.seriesName,
            year: parsedFileName.year,
          }
        );
    } catch (e) {
      console.log("error finding series: " + e);
    }

    if (!series) {
      // search metron for the series name and year
      const metronRes = metron.findSeries(
        parsedFileName.seriesName,
        parsedFileName.year
      );

      console.log("metronRes: " + metronRes);
      if (metronRes.results.length == 1) {
        // see if we can find the series in the database by the metron id
        try {
          series = $app.dao().findFirstRecordByFilter("series", "id = {:id}", {
            id: metronRes.results[0].id.toString(),
          });
        } catch (e) {
          console.log("error finding series by id: " + e);
        }

        if (!series) {
          // use the id to get the full details of the series
          const metronSeriesDetails = metron.getSeries(metronRes.results[0].id);
          console.log("metronSeriesDetails: " + metronSeriesDetails);
          // create the series record
          const seriesRecord = new Record(
            $app.dao().findCollectionByNameOrId("series"),
            {
              id: metronSeriesDetails.id,
              name: metronSeriesDetails.name,
              startYear: metronSeriesDetails.year_began,
              endYear: metronSeriesDetails.year_end,
              ended: metronSeriesDetails.year_end ? true : false,
              comicvineId: metronSeriesDetails.cv_id,
              description: metronSeriesDetails.desc,
            }
          );

          $app.dao().saveRecord(seriesRecord);
          console.log("saved series record: ", seriesRecord.get("id"));
          // populate the series
          // get the series record
          series = seriesRecord;
          console.log("is first issue :", +parsedFileName.issueNumber == 1);
          // set up the series image
          if (+parsedFileName.issueNumber == 1) {
            // we can result the cover image from this issue as the cover image for the series
            console.log(
              "this the first issue, get the cover image for the series"
            );
            // download the cover image for the issue
            const coverImageUrl = comic.get("cover");

            const admin = $app.dao().findAdminByEmail("butlerba@gmail.com");
            console.log("admin: ", admin);
            const fileToken = $tokens.adminFileToken($app, admin);

            const coverFile = $filesystem.fileFromUrl(
              `http://127.0.0.1:8090/api/files/${
                $app.dao().findCollectionByNameOrId("comics").id
              }/${comic.id}/${coverImageUrl}?token=${fileToken}`
            );

            coverFile.name = "series_image.webp";
            coverFile.originalName = "series_image.webp";
            // start the series form
            const form = new RecordUpsertForm($app, series);
            // manually upload file(s)
            form.addFiles("seriesImage", coverFile);

            // validate and submit (internally it calls $app.dao().saveRecord(record) in a transaction)
            form.submit();
          } else {
            console.log("looking for the first issue in the series");
            // we need to search for the first issue in metron
            const metronIssue = metron.findIssue(metronSeriesDetails.id, "1");

            // now get the issue details
            const metronIssueDetails = metron.getIssue(
              metronIssue.results[0].id
            );

            // download the cover image for the issue
            const coverImageReponse = $http.send({
              url: metronIssueDetails.image,
              method: "GET",
            });
            // make sure the temp_matching folder is created
            $os.mkdirAll("/comics/temp_matching", 0o777);
            const parts = metronIssueDetails.image.split("/");
            // write the file to the fs
            $os.writeFile(
              `/comics/temp_matching/${parts[parts.length - 1]}`,
              coverImageReponse.raw
            );
            // convert the file to our webp format and size
            const destCoverFileName = `/comics/temp_matching/series_cover.webp`;
            try {
              const convertCover = $os.exec(
                "cwebp",
                "-q",
                "60",
                "-resize",
                "400",
                "600",
                `/comics/temp_matching/${parts[parts.length - 1]}`,
                "-o",
                destCoverFileName
              );
              convertCover.run();
            } catch (e) {
              console.log("error converting cover to webp: " + e);
            }

            // load up the file
            const convertedCoverFile =
              $filesystem.fileFromPath(destCoverFileName);

            // start the series form
            const form = new RecordUpsertForm($app, series);
            // manually upload file(s)
            form.addFiles("seriesImage", convertedCoverFile);

            // validate and submit (internally it calls $app.dao().saveRecord(record) in a transaction)
            form.submit();

            // remove all the files in the temp_matching folder
            const removeFiles = $os.exec(
              "rm",
              "-rf",
              "/comics/temp_matching/*"
            );
            removeFiles.run();
          }
        }

        console.log("creating new series");
        // add the parsed file name to the series as series allias
        const newAllias = new Record(
          $app.dao().findCollectionByNameOrId("seriesAllias"),
          {
            series: series.get("id"),
            name: parsedFileName.seriesName,
          }
        );

        $app.dao().saveRecord(newAllias);

        // update the series to include the allias
        series.set("alliases", [
          ...series.get("alliases"),
          newAllias.get("id"),
        ]);
        $app.dao().saveRecord(series);
      }
    }

    // add the comic to the series
    series.set("issues", [...series.get("issues"), comic.get("id")]);

    // save the series
    $app.dao().saveRecord(series);

    // update the comic record with the series id
    comic.set("series", series.get("id"));
    comic.set("matched", true);

    // get find the issue from metron
    const metronIssue = metron.findIssue(
      series.get("id"),
      parsedFileName.issueNumber
    );
    console.log("metronIssue: " + metronIssue);

    // get the issue details
    const metronIssueDetails = metron.getIssue(metronIssue.results[0].id);

    // update the issue record
    comic.set("metronId", metronIssueDetails.id);
    comic.set("comicvineId", metronIssueDetails.cv_id);
    comic.set("description", metronIssueDetails.desc);
    comic.set("publishDate", metronIssueDetails.cover_date);

    $app.dao().saveRecord(comic);

    // for each of the characters in the issue, see if they exist in the database
    // if they do, add them to the comic record, and add the issue to the character record
    // and to the series, and add the series to the character record
    for (let i = 0; i < metronIssueDetails.characters.length; i++) {
      const characterId = metronIssueDetails.characters[i].id.toString();

      let character;
      try {
        character = $app
          .dao()
          .findFirstRecordByFilter("characters", "id = {:id}", {
            id: characterId,
          });
      } catch (e) {
        console.log("error finding character (id: " + characterId + "): " + e);
      }

      if (!character) {
        // get the character details from metron
        const metronCharacterDetails = metron.getCharacter(characterId);
        console.log("character name: " + metronCharacterDetails.name);
        // create the character record
        character = new Record(
          $app.dao().findCollectionByNameOrId("characters"),
          {
            id: metronCharacterDetails.id,
            name: metronCharacterDetails.name,
            description: metronCharacterDetails.desc,
            comicvineId:
              metronCharacterDetails.cv_id ??
              `unknown-${metronCharacterDetails.id}`,
          }
        );

        $app.dao().saveRecord(character);

        // get the character image
        const characterImage = $http.send({
          url: metronCharacterDetails.image,
          method: "GET",
        });

        // make sure the temp_matching folder is created
        $os.mkdirAll("/comics/temp_matching", 0o777);

        const parts = metronCharacterDetails.image.split("/");

        // write the file to the fs
        $os.writeFile(
          `/comics/temp_matching/${parts[parts.length - 1]}`,
          characterImage.raw
        );
        console.log("wrote file");
        // convert the file to our webp format and size
        const destCharacterFileName = `/comics/temp_matching/${character
          .get("name")
          .replace(" ", "_")
          .toLowerCase()}.webp`;
        try {
          const convertCharacter = $os.exec(
            "cwebp",
            "-q",
            "60",
            "-resize",
            "400",
            "600",
            `/comics/temp_matching/${parts[parts.length - 1]}`,
            "-o",
            destCharacterFileName
          );
          convertCharacter.run();
        } catch (e) {
          console.log("error converting character to webp: " + e);
        }

        // load up the file
        const convertedCharacterFile = $filesystem.fileFromPath(
          destCharacterFileName
        );

        // start the character form
        const form = new RecordUpsertForm($app, character);
        // manually upload file(s)
        form.addFiles("image", convertedCharacterFile);

        // validate and submit (internally it calls $app.dao().saveRecord(record) in a transaction)
        form.submit();
      }

      console.log("adding character to comic");
      // add the character to the comic
      comic.set("characters", [
        ...comic.get("characters"),
        character.get("id"),
      ]);
      $app.dao().saveRecord(comic);

      console.log("adding comic to character");
      // add the comic to the character
      character.set("issues", [...character.get("issues"), comic.get("id")]);
      $app.dao().saveRecord(character);

      // add the series to the character
      if (character.get("series").indexOf(series.get("id")) < 0) {
        console.log("adding character to series");
        character.set("series", [...character.get("series"), series.get("id")]);
        $app.dao().saveRecord(character);
      }

      if (series.get("characters").indexOf(character.get("id")) < 0) {
        console.log("adding character to series");
        // add the character to the series
        series.set("characters", [
          ...series.get("characters"),
          character.get("id"),
        ]);
        $app.dao().saveRecord(series);
      }
    }

    return c.json(200, { message: "Success", data: comic });
  } catch (e) {
    console.log("error: " + e);
    return c.json(500, { message: "Error", error: e });
  }
});
