let runtimeActive = false;

const footerRuntime = () => {
  if (!runtimeActive) {
    return;
  }

  const startTime = theme.footerStart;
  if (!startTime) {
    runtimeActive = false;
    return;
  }

  window.setTimeout(footerRuntime, 1000);

  const startDate = new Date(startTime);
  const startTimestamp = startDate.getTime();
  if (!Number.isFinite(startTimestamp)) {
    runtimeActive = false;
    return;
  }

  const elapsedSeconds = Math.max(
    0,
    Math.floor((Date.now() - startTimestamp) / 1000),
  );
  const days = Math.floor(elapsedSeconds / 86400);
  const hours = Math.floor((elapsedSeconds % 86400) / 3600);
  const minutes = Math.floor((elapsedSeconds % 3600) / 60);
  const seconds = elapsedSeconds % 60;

  const runtimeDays = document.getElementById("runtime_days");
  const runtimeHours = document.getElementById("runtime_hours");
  const runtimeMinutes = document.getElementById("runtime_minutes");
  const runtimeSeconds = document.getElementById("runtime_seconds");

  if (runtimeDays) runtimeDays.innerHTML = days;
  if (runtimeHours) runtimeHours.innerHTML = hours;
  if (runtimeMinutes) runtimeMinutes.innerHTML = minutes;
  if (runtimeSeconds) runtimeSeconds.innerHTML = seconds;
};

export default function initFooterRuntime() {
  if (runtimeActive) {
    return;
  }

  runtimeActive = true;
  footerRuntime();
}
