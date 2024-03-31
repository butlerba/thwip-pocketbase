"use strict";

let Metron = {
  findSeries: (name, year) => {
    const res = $http.send({
      url: `https://metron.cloud/api/series/?name=${encodeURIComponent(
        name
      )}&year_began=${year}`,
      method: "GET",
      headers: {
        accept: "application/json",
        Authorization: "Basic YnV0bGVyYmE6Y3phamthVEtFMjAxNSE=",
      },
    });
    console.log(res.statusCode);
    console.log(res.json);
    sleep(5000);
    return res.json;
  },
  getSeries: (seriesId) => {
    console.log("getSeries ", seriesId);
    const res = $http.send({
      url: `https://metron.cloud/api/series/${seriesId}/`,
      method: "GET",
      headers: {
        accept: "application/json",
        Authorization: "Basic YnV0bGVyYmE6Y3phamthVEtFMjAxNSE=",
      },
    });
    console.log(res.statusCode);
    console.log(res.json);
    sleep(5000);
    return res.json;
  },
  findIssue: (seriesId, issueNumber) => {
    const res = $http.send({
      url: `https://metron.cloud/api/issue/?series_id=${seriesId}&number=${+issueNumber}`,
      method: "GET",
      headers: {
        accept: "application/json",
        Authorization: "Basic YnV0bGVyYmE6Y3phamthVEtFMjAxNSE=",
      },
    });
    console.log(res.statusCode);
    console.log(res.json);
    sleep(5000);
    return res.json;
  },
  getIssue: (issueId) => {
    const res = $http.send({
      url: `https://metron.cloud/api/issue/${issueId}/`,
      method: "GET",
      headers: {
        accept: "application/json",
        Authorization: "Basic YnV0bGVyYmE6Y3phamthVEtFMjAxNSE=",
      },
    });
    console.log(res.statusCode);
    console.log(res.json);
    sleep(5000);
    return res.json;
  },
  getCharacter: (characterId) => {
    const res = $http.send({
      url: `https://metron.cloud/api/character/${characterId}/`,
      method: "GET",
      headers: {
        accept: "application/json",
        Authorization: "Basic YnV0bGVyYmE6Y3phamthVEtFMjAxNSE=",
      },
    });
    console.log(res.statusCode);
    console.log(res.json);
    sleep(5000);
    return res.json;
  },
};

module.exports = Metron;
