let time = 30;
let serverStartTime = 0;

function generateSessionsTable(sessionsData) {
  let result = '<table>\n';

  result += `<tr>
    <th scope="col">Gaming Sessions</th>
    <th scope="col">Players</th>
    <th scope="col" id="title_update">Latest TU</th>
  </tr>\n`;

  if (sessionsData?.Metadata) {
    let Build_Commit = sessionsData?.Metadata.HEROKU_BUILD_COMMIT;
    let Released_At = sessionsData?.Metadata.HEROKU_RELEASE_CREATED_AT;

    if (!serverStartTime) {
      serverStartTime = new Date(sessionsData?.Metadata.START_TIME);
      updateUptime();
    }

    let BUILD_COMMIT = $('#BUILD_COMMIT');
    let RELEASE_CREATED_AT = $('#RELEASE_CREATED_AT');

    if (Released_At) {
      Released_At = new Date(
        sessionsData?.Metadata.HEROKU_RELEASE_CREATED_AT,
      ).toDateString();
    } else {
      Released_At = 'N/A';
    }

    RELEASE_CREATED_AT.text(Released_At);

    if (Build_Commit) {
      const Commit_URL = `https://github.com/AdrianCassar/Xenia-WebServices/commit/${Build_Commit}`;
      BUILD_COMMIT.attr('href', Commit_URL);
      BUILD_COMMIT.text(
        `${sessionsData?.Metadata.HEROKU_BUILD_COMMIT.substring(0, 7)}`,
      );
    } else {
      BUILD_COMMIT.removeAttr('target');
      BUILD_COMMIT.attr('href', '#');
      BUILD_COMMIT.text(`N/A`);
    }
  }

  sessionsData?.Titles?.forEach((titleInfo) => {
    let title = 'N/A';

    if (titleInfo?.info?.TitleID) {
      title = titleInfo.info.Name;
    } else if (titleInfo?.name) {
      title = titleInfo.name;
    }

    for (const session of titleInfo?.sessions) {
      let Version_Text =
        session.version && isValidVersion(session.version)
          ? session.version
          : 'N/A';
      let MediaID_Text =
        session.mediaId &&
        session.mediaId != 0 &&
        isHexadecimal(session.mediaId)
          ? session.mediaId
          : 'N/A';

      let TU_Text = 'N/A';
      let TU_download_url = '#';

      if (titleInfo.info?.TitleID && session.mediaId) {
        const Title_Update = GetLatestTU(titleInfo.info, session.mediaId);

        if (Title_Update) {
          TU_download_url = `http://xboxunity.net/Resources/Lib/TitleUpdate.php?tuid=${Title_Update.TitleUpdateID}`;
          TU_Text = `TU: ${Title_Update.Version}`;
        }
      }

      const icon_asset = titleInfo.icon || 'assets/icon.svg';
      const icon = `<div class="image"><img src="${icon_asset}" width="64" height="64" alt="${title}" title="${title}"></div>`;

      // PLAYER IDENTIFIERS ARE NOT RENDERED.
      //
      // The /sessions payload still contains host_gamertag, host_xuid and the real gamertag roster, and
      // that endpoint is unauthenticated -- so this is a casual-browsing measure, not a privacy boundary.
      // It stops the public page from publishing a live who-is-online-right-now list to anyone who loads
      // the root URL. To make it an actual boundary, strip the fields server-side in
      // AggregateSessionCommandHandler instead.
      //
      // The roster is replaced with positional labels so the occupancy grid keeps its shape and count.
      const HOST_PRESENCE = session.host_presence;
      const presence_div = HOST_PRESENCE
        ? `<div style="white-space: pre-line;">${HOST_PRESENCE}</div>`
        : '';

      let player_slots = 'Player 1';

      if (Array.isArray(session.players)) {
        player_slots = session.players
          .map(
            (_player, index) =>
              `<div ${index == 0 ? 'id="host_item"' : ''} class="list-item">Player ${index + 1}</div>`,
          )
          .join('');
      }

      const gridAdjustment =
        session.players.length < 3
          ? `style="grid-template-columns: repeat(${session.players.length}, 1fr);"`
          : '';

      result += `<tr>
        <td>
          <div class="container">
            ${icon}
            <div class="box">
              <div id="game_title"><a href="https://github.com/xenia-project/game-compatibility/issues?q=is:issue%20is:open ${titleInfo.titleId}" target="_blank">${title}</a></div>
              ${presence_div}
            </div>
            <div class="box">
              <div class="entry">Title ID: ${titleInfo.titleId}</div>
              <div class="entry">Media ID: ${MediaID_Text}</div>
              <div class="entry">Version: ${Version_Text}</div>
            </div>
          </div>
        </td>
        <td>
          <div ${gridAdjustment} class="list-container" id="list">
            ${player_slots ? player_slots : 'Player 1'}
          </div>
          <label>${session.players.length ? session.players.length : '1'} of ${session.total}</label>
        </td>
        <td id="title_update"><a href="${TU_download_url}">${TU_Text}</a></td>
      </tr>\n`;
    }
  });

  result += '</table>\n';
  return result;
}

function GetLatestTU(titleInfo, mediaId) {
  if (mediaId == 0) {
    return;
  }

  let latestTU;
  titleInfo?.MediaIds?.forEach((media) => {
    if (media.MediaID == mediaId) {
      const lastIndex = media['Updates'].length - 1;
      latestTU = media['Updates'][lastIndex];
    }
  });

  return latestTU;
}

function isHexadecimal(s) {
  try {
    return !isNaN(parseInt(s, 16));
  } catch {
    return false;
  }
}

function isValidVersion(version) {
  return /^(\d+\.)?(\d+\.)?(\d+\.)(\d+)$/.test(version);
}

let table_loaded = false;

function refreshSessionTable() {
  $.getJSON(window.origin + '/sessions')
    .done(function (sessionData) {
      const sessionTable = generateSessionsTable(sessionData);

      if (table_loaded) {
        $('#sessions').html(sessionTable);
      } else {
        // Animate skeleton loader for 2s on first load
        setTimeout(() => {
          $('#sessions').html(sessionTable);
          table_loaded = true;
        }, 2000);
      }
    })
    .fail(function (jqXHR) {
      console.log(`Error ${jqXHR.status}`);
    });
}

function formatUTCToDDHHMMSS(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / (60 * 60 * 24));
  const hours = Math.floor((totalSeconds % (60 * 60 * 24)) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const hh = hours.toString().padStart(2, '0');
  const mm = minutes.toString().padStart(2, '0');
  const ss = seconds.toString().padStart(2, '0');

  return `${days}d ${hh}:${mm}:${ss}`;
}

function updateUptime() {
  if (serverStartTime > 0) {
    const diffMs = new Date() - serverStartTime;
    const uptimeStr = formatUTCToDDHHMMSS(diffMs);

    $('#UPTIME').html(uptimeStr);
  }
}

function refreshTimer() {
  if (time <= 0) {
    time = 30;
    refreshSessionTable();
  }

  if (document.readyState === 'complete') {
    $('#countdown').html(`Refreshing in ${time}s`);
    updateUptime();

    time -= 1;
  }
}

function setIntervalImmediately(func, interval) {
  func();
  return setInterval(func, interval);
}

$(document).ready(function () {
  setIntervalImmediately(refreshTimer, 1000);
  refreshSessionTable();
});

$(document).on('click', '#server_details_btn', function () {
  $('#server_details').toggle();
});
