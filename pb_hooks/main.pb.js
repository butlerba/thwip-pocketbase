/// <reference path="../pb_data/types.d.ts" />

routerAdd("GET", "/hello/:name", (c) => {
  let name = c.pathParam("name");

  return c.json(200, { message: "Hello " + name });
});

// enable the cron to run every 15 minutes
cronAdd("comicImport", "*/15 * * * *", async () => {
  const utils = require(`${__hooks}/utils.js`);

  try {
    const allFiles = utils.getAllFiles("/comics/new");

    // take the first 5 files and process them
    const filesToProcess = allFiles.slice(0, 15);

    for (let i = 0; i < filesToProcess.length; i++) {
      try {
        if (!utils.checkIfFileExistsInSystem(filesToProcess[i])) {
          // if the file doesn't exist in the system, process it
          // get the file name
          const file = filesToProcess[i];
          const fileParts = file.split("/");
          // get the comic data
          const parsedFileName = utils.parseFileName(
            fileParts[fileParts.length - 1]
          );
          console.log("parsedFileName: " + parsedFileName);
          console.log("created comic record");
          // create the comic record
          let comicRecord = utils.createComicRecord(
            parsedFileName,
            fileParts[fileParts.length - 1]
          );

          console.log("comic record", comicRecord);

          const extractedFiles = await utils.extractFiles(
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

          await utils.convertToWebp(pageFiles);
          console.log("converted");
          // update the comic record with the cover image
          comicRecord = utils.createCoverImage(
            comicRecord,
            "/comics/temp/cover.webp"
          );
          console.log("cover created");
          // get all the non-cover images
          const allConvertedFiles = utils.getAllConvertedFiles();
          console.log("allConvertedFiles: " + allConvertedFiles);
          comicRecord = utils.createComicPages(comicRecord, allConvertedFiles);

          utils.moveFileToComplete(filesToProcess[i]);

          utils.cleanUpTempFiles();
        } else {
          // just move it to the processed folder
          utils.moveFileToComplete(filesToProcess[i]);
        }
      } catch (e) {
        console.log("error processing file: " + e);
        try {
          utils.moveFileToErrored(filesToProcess[i]);
          utils.cleanUpTempFiles();
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
      utils.cleanUpTempFiles();
    } catch (e) {
      console.log("error cleaning up: " + e);
    }
  }
});

cronAdd("comicMatch", "20 * * * *", async () => {
  const metron = require(`${__hooks}/metron.js`);
  const utils = require(`${__hooks}/utils.js`);

  let unmatchedComics = [];
  try {
    unmatchedComics = $app
      .dao()
      .findRecordsByFilter(
        "comics",
        "matched = {:matched} && needsManualMatch = false",
        "created",
        20,
        0,
        {
          matched: false,
        }
      );
  } catch (e) {
    console.log("error getting unmatched comics: " + e);
  }

  console.log("unmatchedComics: " + unmatchedComics);
  if (unmatchedComics.length == 0) {
    console.log("no unmatched comics");
    return;
  }

  for (let c = 0; c < unmatchedComics.length; c++) {
    try {
      // get the first non-matched comic from the db
      const comic = unmatchedComics[c];

      console.log("comic: " + comic.get("fileName"));

      // parse the file name to get the series name, issue number, and year
      const parsedFileName = utils.parseFileName(comic.get("fileName"));
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
            series = $app
              .dao()
              .findFirstRecordByFilter("series", "id = {:id}", {
                id: metronRes.results[0].id.toString(),
              });
          } catch (e) {
            console.log("error finding series by id: " + e);
          }

          if (!series) {
            // use the id to get the full details of the series
            const metronSeriesDetails = metron.getSeries(
              metronRes.results[0].id
            );
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
        } else {
          // update the comic record to say it needs manual matching
          comic.set("needsManualMatch", true);
          $app.dao().saveRecord(comic);

          continue;
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

      if (!metronIssue.results || metronIssue.results.length == 0) {
        // update the comic record to say it needs manual matching
        comic.set("needsManualMatch", true);
        $app.dao().saveRecord(comic);

        // remove the comic from the series
        series.set(
          "issues",
          series.get("issues").filter((i) => i !== comic.get("id"))
        );
        $app.dao().saveRecord(series);

        continue;
      }

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
          console.log(
            "error finding character (id: " + characterId + "): " + e
          );
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
          character.set("series", [
            ...character.get("series"),
            series.get("id"),
          ]);
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
    } catch (e) {
      console.log("error: " + e);
      continue;
    }
  }

  console.log("comics matched finished");
});

routerAdd("GET", "/metron/search-series", async (c) => {
  try {
    console.log("searching");
    const query = c.queryParam("query");
    const year = c.queryParam("year");
    // web encode the query

    console.log("query: " + query);
    console.log("year: " + year);
    const metron = require(`${__hooks}/metron.js`);

    const res = await metron.findSeries(query, year);

    return c.json(200, { message: "Success", data: res });
  } catch (e) {
    console.log("error: " + e);
    return c.json(500, { message: "Error", error: e });
  }
});

routerAdd("POST", "/metron/add-series", async (c) => {
  try {
    // get the body
    const body = $apis.requestInfo(c).data;
    console.log("body: " + body);
    if (!body) {
      return c.json(400, { message: "Error", error: "No body provided" });
    }

    const metron = require(`${__hooks}/metron.js`);
    const utils = require(`${__hooks}/utils.js`);

    // convert the body to json
    //const jsonBody = JSON.parse(body);

    // get the series id
    const seriesId = body.seriesId;
    // get any alliases values
    const alliases = body.alliases;

    // make sure the series doesn't already exist
    let series;
    try {
      series = $app
        .dao()
        .findFirstRecordByFilter("series", "id = {:id}", { id: seriesId });
    } catch (e) {
      console.log("error finding series: " + e);
    }

    if (series) {
      return c.json(400, {
        message: "Error",
        error: "Series already exists in the database",
      });
    }

    // get the series details from metron
    const metronSeriesDetails = metron.getSeries(seriesId);

    // create the series record
    series = new Record($app.dao().findCollectionByNameOrId("series"), {
      id: metronSeriesDetails.id,
      name: metronSeriesDetails.name,
      startYear: metronSeriesDetails.year_began,
      endYear: metronSeriesDetails.year_end,
      ended: metronSeriesDetails.year_end ? true : false,
      comicvineId: metronSeriesDetails.cv_id,
      description: metronSeriesDetails.desc,
    });

    $app.dao().saveRecord(series);

    // add the alliases
    for (let i = 0; i < alliases.length; i++) {
      const allias = new Record(
        $app.dao().findCollectionByNameOrId("seriesAllias"),
        {
          series: series.get("id"),
          name: alliases[i],
        }
      );

      $app.dao().saveRecord(allias);

      // update the series to include the allias
      series.set("alliases", [...series.get("alliases"), allias.get("id")]);
      $app.dao().saveRecord(series);
    }

    // get the cover image
    console.log("looking for the first issue in the series");
    // we need to search for the first issue in metron
    const metronIssue = metron.findIssue(metronSeriesDetails.id, "1");

    // now get the issue details
    const metronIssueDetails = metron.getIssue(metronIssue.results[0].id);

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
    const convertedCoverFile = $filesystem.fileFromPath(destCoverFileName);

    // start the series form
    const form = new RecordUpsertForm($app, series);
    // manually upload file(s)
    form.addFiles("seriesImage", convertedCoverFile);

    // validate and submit (internally it calls $app.dao().saveRecord(record) in a transaction)
    form.submit();

    // remove all the files in the temp_matching folder
    const removeFiles = $os.exec("rm", "-rf", "/comics/temp_matching/*");
    removeFiles.run();

    // now we should look for any issues that have been marked as needing manual matching
    // that have the same series name, and a year between the start and end year of the series
    // and mark them as not needing manual matching
    let possibleMatches = [];
    try {
      possibleMatches = $app
        .dao()
        .findRecordsByFilter(
          "comics",
          "needsManualMatch = true && name ~ {:seriesName}",
          "created",
          0,
          0,
          {
            series: series.get("name"),
          }
        );
    } catch (e) {
      console.log("error finding possible matches: " + e);
    }

    for (let i = 0; i < possibleMatches.length; i++) {
      const possibleMatch = possibleMatches[i];
      possibleMatch.set("needsManualMatch", false);
      $app.dao().saveRecord(possibleMatch);
    }

    return c.json(200, { message: "Success", data: series });
  } catch (e) {
    console.log("error: " + e);
    return c.json(500, { message: "Error", error: e });
  }
});

routerAdd("POST", "/reset-needs-manual-match", async (c) => {
  try {
    // make sure the header has the correct reset token
    const resetToken = c.request().header.get("reset-token");
    if (resetToken !== ProcessingInstruction.env.RESET_TOKEN) {
      return c.json(401, { message: "Error", error: "Invalid reset token" });
    }

    let possibleMatches = [];
    try {
      possibleMatches = $app
        .dao()
        .findRecordsByFilter(
          "comics",
          "needsManualMatch = true",
          "created",
          0,
          0
        );
    } catch (e) {
      console.log("error finding possible matches: " + e);
    }
    console.log("possibleMatches: " + possibleMatches.length);
    for (let i = 0; i < possibleMatches.length; i++) {
      const possibleMatch = possibleMatches[i];
      possibleMatch.set("needsManualMatch", false);
      $app.dao().saveRecord(possibleMatch);
    }

    return c.json(200, { message: "Success" });
  } catch (e) {
    console.log("error: " + e);
    return c.json(500, { message: "Error", error: e });
  }
});

routerAdd("GET", "metron/match-comic", async (c) => {
  const metron = require(`${__hooks}/metron.js`);
  const utils = require(`${__hooks}/utils.js`);

  try {
    // get the first non-matched comic from the db
    const comic = $app
      .dao()
      .findFirstRecordByFilter(
        "comics",
        "matched = {:matched} && needsManualMatch = false",
        {
          matched: false,
        }
      );

    console.log("comic: " + comic.get("fileName"));

    // parse the file name to get the series name, issue number, and year
    const parsedFileName = utils.parseFileName(comic.get("fileName"));
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
      } else {
        // update the comic record to say it needs manual matching
        comic.set("needsManualMatch", true);
        $app.dao().saveRecord(comic);

        return c.json(200, {
          message: "Success",
          data: comic,
        });
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

    if (!metronIssue.results || metronIssue.results.length == 0) {
      // update the comic record to say it needs manual matching
      comic.set("needsManualMatch", true);
      $app.dao().saveRecord(comic);

      // remove the comic from the series
      series.set(
        "issues",
        series.get("issues").filter((i) => i !== comic.get("id"))
      );
      $app.dao().saveRecord(series);

      return c.json(200, {
        message: "Success",
        data: comic,
      });
    }

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
