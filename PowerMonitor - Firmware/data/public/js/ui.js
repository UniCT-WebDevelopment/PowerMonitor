//UI Management.

$(document).ready(UI_refresh_events);

function UI_refresh_events(){
	$(".switch .body")
		.unbind("click")
		.on("click", function(){
			$(this).toggleClass("switch_enabled");
		});
}
