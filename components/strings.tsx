export function getVideoIDFromURL(url: string) {
    var regExp = /^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(shorts\/)|(embed\/)|(watch\?))\??v?=?([^#&?]*).*/;
    var match = url.match(regExp);
    console.log(match)
    return (match && match[8].length == 11) ? match[8] : undefined;
}