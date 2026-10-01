interface RoomScreensaverProps {
  label: string;
  time: string;
  date: string;
  dateTime: string;
}

export function RoomScreensaver({ label, time, date, dateTime }: RoomScreensaverProps) {
  return (
    <section className="room-screensaver" aria-label={label} data-room-screensaver="true" tabIndex={0}>
      <div className="room-screensaver__content">
        <time className="room-screensaver__time" dateTime={dateTime}>{time}</time>
        <time className="room-screensaver__date" dateTime={dateTime}>{date}</time>
      </div>
    </section>
  );
}
